use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox");

pub const ZK_LOCATION_PROGRAM_ID: Pubkey = pubkey!("Hr7Wh6PHTsS7e74HQWtafBjNhj9egXQgAM9yeWSnwsDD");
pub const MAX_QUESTION_LEN: usize = 128;
pub const MAX_URL_LEN: usize = 256;
pub const OUTCOME_NONE: u8 = 0;
pub const OUTCOME_YES: u8 = 1;
pub const OUTCOME_NO: u8 = 2;

#[program]
pub mod hyperlocal_markets {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        region_id: [u8; 32],
        question: String,
        close_time: i64,
        manifest_url: String,
        manifest_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            question.as_bytes().len() <= MAX_QUESTION_LEN,
            MarketError::QuestionTooLong
        );
        let qhash = question_hash(&question);
        let market = &mut ctx.accounts.market;
        market.region_id = region_id;
        market.question = question;
        market.question_hash = qhash;
        market.close_time = close_time;
        market.resolved = false;
        market.outcome = 0;
        market.usdc_mint = ctx.accounts.usdc_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.resolver = ctx.accounts.resolver.key();
        market.market_bump = ctx.bumps.market;
        market.creator = ctx.accounts.payer.key();
        // Seed tiny priors to avoid division by zero; negligible vs real flow.
        market.yes_shares = 1;
        market.no_shares = 1;
        market.total_pool = 0;
        market.manifest_url = manifest_url;
        market.manifest_hash = manifest_hash;
        market.resolved_evidence_url = "".to_string();
        market.status = ResolutionStatus::Open;
        market.agent_outcome = OUTCOME_NONE;
        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        amount: u64,
        side: Side,
        min_shares_out: u64,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        let user_location = &ctx.accounts.user_location;

        require!(user_location.is_verified, MarketError::LocationNotVerified);
        require!(
            user_location.region_id == market.region_id,
            MarketError::WrongRegion
        );
        require!(!market.resolved, MarketError::MarketClosed);
        require!(
            Clock::get()?.unix_timestamp < market.close_time,
            MarketError::MarketClosed
        );

        // Transfer USDC into the vault.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // DPM math.
        let mut yes = market.yes_shares as u128;
        let mut no = market.no_shares as u128;
        let current_pool = market.total_pool as u128;
        let amount_u128 = amount as u128;
        let new_total = current_pool
            .checked_add(amount_u128)
            .ok_or(MarketError::MathOverflow)?;

        let (new_yes, new_no, minted) = match side {
            Side::Yes => {
                if no == 0 {
                    no = 1;
                }
                let new_yes_shares = isqrt(
                    new_total
                        .checked_mul(new_total)
                        .ok_or(MarketError::MathOverflow)?
                        .checked_sub(no.checked_mul(no).ok_or(MarketError::MathOverflow)?)
                        .ok_or(MarketError::MathOverflow)?,
                );
                let minted = new_yes_shares
                    .checked_sub(yes)
                    .ok_or(MarketError::MathUnderflow)?;
                (new_yes_shares, no, minted)
            }
            Side::No => {
                if yes == 0 {
                    yes = 1;
                }
                let new_no_shares = isqrt(
                    new_total
                        .checked_mul(new_total)
                        .ok_or(MarketError::MathOverflow)?
                        .checked_sub(yes.checked_mul(yes).ok_or(MarketError::MathOverflow)?)
                        .ok_or(MarketError::MathOverflow)?,
                );
                let minted = new_no_shares
                    .checked_sub(no)
                    .ok_or(MarketError::MathUnderflow)?;
                (yes, new_no_shares, minted)
            }
        };

        require!(
            minted >= min_shares_out as u128,
            MarketError::SlippageExceeded
        );

        // Update market.
        let market = &mut ctx.accounts.market;
        market.total_pool =
            u64::try_from(new_total).map_err(|_| MarketError::MathOverflow)?;
        match side {
            Side::Yes => market.yes_shares = new_yes as u128,
            Side::No => market.no_shares = new_no as u128,
        }

        // Update user position.
        let user_pos = &mut ctx.accounts.user_position;
        user_pos.bump = ctx.bumps.user_position;
        match side {
            Side::Yes => user_pos.yes_shares = user_pos
                .yes_shares
                .checked_add(minted)
                .ok_or(MarketError::MathOverflow)?,
            Side::No => user_pos.no_shares = user_pos
                .no_shares
                .checked_add(minted)
                .ok_or(MarketError::MathOverflow)?,
        }

        emit!(OrderPlaced {
            trader: ctx.accounts.trader.key(),
            market: market.key(),
            amount,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: Outcome) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.resolved, MarketError::AlreadyResolved);
        require!(
            ctx.accounts.resolver.key() == market.resolver,
            MarketError::UnauthorizedResolver
        );
        market.resolved = true;
        market.outcome = match outcome {
            Outcome::Yes => 1,
            Outcome::No => 2,
        };
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.resolved, MarketError::NotResolved);

        let user_pos = &mut ctx.accounts.user_position;
        require!(!user_pos.claimed, MarketError::AlreadyClaimed);

        let (winning_total, user_shares) = match market.outcome {
            1 => (market.yes_shares, user_pos.yes_shares),
            2 => (market.no_shares, user_pos.no_shares),
            _ => return err!(MarketError::NotResolved),
        };
        require!(winning_total > 0, MarketError::MathUnderflow);

        let payout_u128 = user_shares
            .checked_mul(market.total_pool as u128)
            .ok_or(MarketError::MathOverflow)?
            .checked_div(winning_total)
            .ok_or(MarketError::MathUnderflow)?;

        let payout = u64::try_from(payout_u128).map_err(|_| MarketError::MathOverflow)?;

        // Transfer from vault to user.
        let question_hash = market.question_hash;
        let seeds: &[&[u8]] = &[
            b"market",
            market.creator.as_ref(),
            question_hash.as_ref(),
            &[market.market_bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_usdc.to_account_info(),
                authority: market.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, payout)?;

        user_pos.claimed = true;
        Ok(())
    }

    pub fn agent_attempt_resolution(
        ctx: Context<AgentAttemptResolution>,
        outcome: u8,
        evidence: String,
        reason: String,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        market.agent_outcome = outcome;
        market.resolved_evidence_url = evidence.clone();

        if outcome == OUTCOME_YES || outcome == OUTCOME_NO {
            market.outcome = outcome;
            market.resolved = true;
            market.status = ResolutionStatus::Resolved;
        } else {
            market.status = ResolutionStatus::Disputed;
        }

        emit!(MarketResolved {
            market: market.key(),
            outcome,
            evidence_url: evidence,
            is_agent: true,
            reason,
        });
        Ok(())
    }

    pub fn creator_resolve_market(
        ctx: Context<CreatorResolveMarket>,
        outcome: u8,
        evidence: String,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let signer = &ctx.accounts.signer;

        require_keys_eq!(market.creator, signer.key(), MarketError::UnauthorizedCreator);
        require!(
            outcome == OUTCOME_YES || outcome == OUTCOME_NO,
            MarketError::InvalidOutcome
        );

        market.outcome = outcome;
        market.resolved = true;
        market.agent_outcome = outcome;
        market.status = ResolutionStatus::Resolved;
        market.resolved_evidence_url = evidence.clone();

        emit!(MarketResolved {
            market: market.key(),
            outcome,
            evidence_url: evidence,
            is_agent: false,
            reason: "CREATOR_OVERRIDE".to_string(),
        });
        Ok(())
    }

    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.resolved, MarketError::NotResolved);
        require!(
            ctx.accounts.resolver.key() == market.resolver,
            MarketError::UnauthorizedResolver
        );

        let winning_total = match market.outcome {
            1 => market.yes_shares,
            2 => market.no_shares,
            _ => 0,
        };
        // Only allow when there were effectively no winning-side bets (just dust).
        require!(winning_total <= 1, MarketError::NoWinningLiquidity);

        let amount = market.total_pool;
        if amount == 0 {
            return Ok(());
        }

        let question_hash = market.question_hash;
        let seeds: &[&[u8]] = &[
            b"market",
            market.creator.as_ref(),
            question_hash.as_ref(),
            &[market.market_bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.resolver_usdc.to_account_info(),
                authority: market.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        market.total_pool = 0;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(region_id: [u8; 32], question: String, close_time: i64, manifest_url: String, manifest_hash: [u8; 32])]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Market::SIZE,
        seeds = [b"market", payer.key().as_ref(), &question_hash(&question)],
        bump
    )]
    pub market: Account<'info, Market>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = market
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: resolver authority
    pub resolver: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        seeds = [b"market", market.creator.as_ref(), market.question_hash.as_ref()],
        bump = market.market_bump
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
    /// CHECK: Anchor enforces owner and seeds; data layout matches ExternalUserLocationState
    #[account(owner = ZK_LOCATION_PROGRAM_ID)]
    pub user_location: Account<'info, ExternalUserLocationState>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + UserPosition::SIZE,
        seeds = [b"user-position", market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,
    #[account(mut, constraint = trader_usdc.mint == market.usdc_mint)]
    pub trader_usdc: Account<'info, TokenAccount>,
    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        mut,
        seeds = [b"market", market.creator.as_ref(), market.question_hash.as_ref()],
        bump = market.market_bump
    )]
    pub market: Account<'info, Market>,
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market", market.creator.as_ref(), market.question_hash.as_ref()],
        bump = market.market_bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"user-position", market.key().as_ref(), trader.key().as_ref()],
        bump = user_position.bump
    )]
    pub user_position: Account<'info, UserPosition>,
    #[account(mut, constraint = trader_usdc.mint == market.usdc_mint)]
    pub trader_usdc: Account<'info, TokenAccount>,
    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AgentAttemptResolution<'info> {
    #[account(mut, has_one = resolver)]
    pub market: Account<'info, Market>,
    /// CHECK: resolver authority (AI agent)
    #[account(signer)]
    pub resolver: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CreatorResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    pub resolver: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market", market.creator.as_ref(), market.question_hash.as_ref()],
        bump = market.market_bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = resolver_usdc.mint == market.usdc_mint)]
    pub resolver_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Market {
    pub region_id: [u8; 32],
    pub question: String,
    pub close_time: i64,
    pub resolved: bool,
    pub outcome: u8,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub resolver: Pubkey,
    pub yes_shares: u128,
    pub no_shares: u128,
    pub total_pool: u64,
    pub creator: Pubkey,
    pub market_bump: u8,
    pub question_hash: [u8; 32],
    pub manifest_url: String,
    pub manifest_hash: [u8; 32],
    pub resolved_evidence_url: String,
    pub status: ResolutionStatus,
    pub agent_outcome: u8,
}

impl Market {
    pub const SIZE: usize = 1000;
}

#[account]
pub struct ExternalUserLocationState {
    pub is_verified: bool,
    pub last_verified_slot: u64,
    pub nullifier: [u8; 32],
    pub region_id: [u8; 32],
}

#[account]
pub struct UserPosition {
    pub yes_shares: u128,
    pub no_shares: u128,
    pub claimed: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const SIZE: usize = 16 + 16 + 1 + 1;
}

#[event]
pub struct OrderPlaced {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Yes,
    No,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: u8,
    pub evidence_url: String,
    pub is_agent: bool,
    pub reason: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionStatus {
    Open,
    Disputed,
    Resolved,
}

#[error_code]
pub enum MarketError {
    #[msg("Location proof not present")]
    LocationNotVerified,
    #[msg("User is outside market region")]
    WrongRegion,
    #[msg("Question too long")]
    QuestionTooLong,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Math underflow")]
    MathUnderflow,
    #[msg("Market closed")]
    MarketClosed,
    #[msg("Market already resolved")]
    AlreadyResolved,
    #[msg("Market not resolved")]
    NotResolved,
    #[msg("Unauthorized resolver")]
    UnauthorizedResolver,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("No winning-side liquidity")]
    NoWinningLiquidity,
    #[msg("Unauthorized creator")]
    UnauthorizedCreator,
    #[msg("Invalid outcome")]
    InvalidOutcome,
}

fn question_hash(question: &str) -> [u8; 32] {
    keccak::hash(question.as_bytes()).to_bytes()
}

fn isqrt(x: u128) -> u128 {
    // Integer sqrt via Newton's method.
    if x == 0 {
        return 0;
    }
    let mut z = (x + 1) >> 1;
    let mut y = x;
    while z < y {
        y = z;
        z = (x / z + z) >> 1;
    }
    y
}
