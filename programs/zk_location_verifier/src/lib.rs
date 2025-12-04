use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use groth16_solana::processor::Groth16Verifier;

pub mod verifying_key;

declare_id!("zkLocaTion111111111111111111111111111111111");

#[program]
pub mod zk_location_verifier {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = *ctx.bumps.get("config").unwrap();
        Ok(())
    }

    pub fn submit_location_proof(
        ctx: Context<SubmitProof>,
        proof: Groth16Proof,
        public_inputs: LocationPublicInputs,
    ) -> Result<()> {
        // Verify Groth16 proof against the embedded verifying key.
        let vk = verifying_key::verifying_key();
        let mut verifier =
            Groth16Verifier::new(vk).map_err(|_| error!(ZkLocationError::InvalidProof))?;
        verifier
            .verify(
                &proof.proof_a,
                &proof.proof_b,
                &proof.proof_c,
                &public_inputs.as_public_inputs(),
            )
            .map_err(|_| error!(ZkLocationError::InvalidProof))?;

        // Compute region_id = keccak(targetLat || targetLon || radiusSq).
        let mut region_seed = Vec::with_capacity(96);
        region_seed.extend_from_slice(&public_inputs.min_lat);
        region_seed.extend_from_slice(&public_inputs.max_lat);
        region_seed.extend_from_slice(&public_inputs.min_lon);
        region_seed.extend_from_slice(&public_inputs.max_lon);
        let region_hash = keccak::hash(&region_seed);

        // Persist membership.
        let user_state = &mut ctx.accounts.user_state;
        user_state.is_verified = true;
    user_state.last_verified_slot = Clock::get()?.slot;
    user_state.nullifier = [0u8; 32];
        user_state.region_id = region_hash.0;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitProof<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + UserLocationState::SIZE,
        seeds = [b"user-state", signer.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserLocationState>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub bump: u8,
}

impl Config {
    pub const SIZE: usize = 1;
}

#[account]
pub struct UserLocationState {
    pub is_verified: bool,
    pub last_verified_slot: u64,
    pub nullifier: [u8; 32],
    pub region_id: [u8; 32],
}

impl UserLocationState {
    pub const SIZE: usize = 1 + 8 + 32 + 32;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Groth16Proof {
    pub proof_a: [[u8; 32]; 2],
    pub proof_b: [[[u8; 32]; 2]; 2],
    pub proof_c: [[u8; 32]; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LocationPublicInputs {
    pub min_lat: [u8; 32],
    pub max_lat: [u8; 32],
    pub min_lon: [u8; 32],
    pub max_lon: [u8; 32],
}

impl LocationPublicInputs {
    pub fn as_public_inputs(&self) -> [[u8; 32]; 4] {
        [
            self.min_lat,
            self.max_lat,
            self.min_lon,
            self.max_lon,
        ]
    }
}

#[error_code]
pub enum ZkLocationError {
    #[msg("Invalid Groth16 proof")]
    InvalidProof,
}
