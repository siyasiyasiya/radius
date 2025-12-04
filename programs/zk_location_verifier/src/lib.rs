use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

pub mod verifying_key;

declare_id!("Hr7Wh6PHTsS7e74HQWtafBjNhj9egXQgAM9yeWSnwsDD");

#[program]
pub mod zk_location_verifier {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn submit_location_proof(
        ctx: Context<SubmitProof>,
        proof: Groth16Proof,
        public_inputs: LocationPublicInputs,
    ) -> Result<()> {
        // Verify Groth16 proof against the embedded verifying key.
        let vk = verifying_key::verifying_key();
        let (proof_a, proof_b, proof_c) = proof.flatten();
        let pub_inputs = public_inputs.as_public_inputs();
        let mut verifier = Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &pub_inputs, &vk)
            .map_err(|_| error!(ZkLocationError::InvalidProof))?;
        verifier.verify().map_err(|_| error!(ZkLocationError::InvalidProof))?;

        // Compute region_id = keccak(targetLat || targetLon || radiusSq).
        let mut region_seed = Vec::with_capacity(96);
        region_seed.extend_from_slice(&public_inputs.min_lat);
        region_seed.extend_from_slice(&public_inputs.max_lat);
        region_seed.extend_from_slice(&public_inputs.min_lon);
        region_seed.extend_from_slice(&public_inputs.max_lon);
        let mut region_id = [0u8; 32];
        for (i, byte) in region_seed.iter().enumerate().take(32) {
            region_id[i] = region_seed[i]
                ^ public_inputs.max_lat[i]
                ^ public_inputs.min_lon[i]
                ^ public_inputs.max_lon[i];
        }

        // Persist membership.
        let user_state = &mut ctx.accounts.user_state;
        user_state.is_verified = true;
    user_state.last_verified_slot = Clock::get()?.slot;
    user_state.nullifier = [0u8; 32];
        user_state.region_id = region_id;

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

impl Groth16Proof {
    pub fn flatten(&self) -> ([u8; 64], [u8; 128], [u8; 64]) {
        let mut a = [0u8; 64];
        a[..32].copy_from_slice(&self.proof_a[0]);
        a[32..].copy_from_slice(&self.proof_a[1]);

        let mut b = [0u8; 128];
        b[..32].copy_from_slice(&self.proof_b[0][0]);
        b[32..64].copy_from_slice(&self.proof_b[0][1]);
        b[64..96].copy_from_slice(&self.proof_b[1][0]);
        b[96..].copy_from_slice(&self.proof_b[1][1]);

        let mut c = [0u8; 64];
        c[..32].copy_from_slice(&self.proof_c[0]);
        c[32..].copy_from_slice(&self.proof_c[1]);

        (a, b, c)
    }
}

#[error_code]
pub enum ZkLocationError {
    #[msg("Invalid Groth16 proof")]
    InvalidProof,
}
