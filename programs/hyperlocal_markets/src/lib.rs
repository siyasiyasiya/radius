use anchor_lang::prelude::*;

declare_id!("hyPeRLocaL11111111111111111111111111111111");

pub const ZK_LOCATION_PROGRAM_ID: Pubkey = pubkey!("zkLocaTion111111111111111111111111111111111");
pub const MAX_QUESTION_LEN: usize = 128;

#[program]
pub mod hyperlocal_markets {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        region_id: [u8; 32],
        question: String,
        close_time: i64,
    ) -> Result<()> {
        require!(
            question.as_bytes().len() <= MAX_QUESTION_LEN,
            MarketError::QuestionTooLong
        );
        let market = &mut ctx.accounts.market;
        market.region_id = region_id;
        market.question = question;
        market.close_time = close_time;
        market.resolved = false;
        market.outcome = 0;
        Ok(())
    }

    pub fn place_order(ctx: Context<PlaceOrder>, amount: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        let user_location = &ctx.accounts.user_location;

        require!(user_location.is_verified, MarketError::LocationNotVerified);
        require!(
            user_location.region_id == market.region_id,
            MarketError::WrongRegion
        );

        emit!(OrderPlaced {
            trader: ctx.accounts.trader.key(),
            market: market.key(),
            amount,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Market::SIZE,
        seeds = [b"market", payer.key().as_ref(), question_seed(&question)],
        bump
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: Anchor enforces owner and seeds; data layout matches ExternalUserLocationState
    #[account(
        seeds = [b"user-state", trader.key().as_ref()],
        bump,
        owner = ZK_LOCATION_PROGRAM_ID
    )]
    pub user_location: Account<'info, ExternalUserLocationState>,
}

#[account]
pub struct Market {
    pub region_id: [u8; 32],
    pub question: String,
    pub close_time: i64,
    pub resolved: bool,
    pub outcome: u8,
}

impl Market {
    pub const SIZE: usize = 32 + 8 + 1 + 1 + 4 + MAX_QUESTION_LEN; // region + close_time + resolved + outcome + string prefix + data
}

#[account]
pub struct ExternalUserLocationState {
    pub is_verified: bool,
    pub last_verified_slot: u64,
    pub nullifier: [u8; 32],
    pub region_id: [u8; 32],
}

#[event]
pub struct OrderPlaced {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[error_code]
pub enum MarketError {
    #[msg("Location proof not present")]
    LocationNotVerified,
    #[msg("User is outside market region")]
    WrongRegion,
    #[msg("Question too long")]
    QuestionTooLong,
}

fn question_seed(question: &str) -> &'_ [u8] {
    let bytes = question.as_bytes();
    if bytes.len() <= 32 {
        bytes
    } else {
        &bytes[..32]
    }
}
