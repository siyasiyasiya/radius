# Radius: ZK-gated Hyperlocal Prediction Markets on Solana

Radius is an end-to-end, privacy-preserving market stack that proves *where* you are without doxxing you, gates trading to that region, and resolves outcomes with an AI + web oracle. It blends modern crypto, zero-knowledge, and LLMs:

- **Circom + Groth16 (BN254):** Browser-generated ZK proofs that your GPS point lies inside a bounding box. Solana BN254 syscalls verify on-chain.
- **Anchor on Solana:** Two programs — a Groth16 verifier that mints a `UserLocationState` PDA, and a square-root DPM market engine that reads that PDA to allow/deny trades. Resolution is dual-path: AI agent or creator override.
- **AI “Context Agent”:** Off-chain resolver (Gemini/OpenAI + Tavily/SerpAPI) that fetches evidence, applies natural-language rules from a manifest, and finalizes outcomes on-chain.
- **Next.js Frontend:** Phantom-based UX that collects geolocation, runs `snarkjs.groth16.fullProve` in the browser, submits proofs, and places trades with slippage control.

For the deep architectural rationale, see `docs/zk-location-architecture.md`.

---

## Architecture at a glance

- `circuits/spatial_check.circom`  
  Groth16 circuit (BN254) proving a user’s lat/lon lies inside a bounding box. Artifacts: `.wasm`, `.zkey`, `verification_key.json`.

- `programs/zk_location_verifier` (Anchor)  
  Verifies Groth16 proofs on-chain (`groth16-salana`), writes `UserLocationState` PDA: `{ is_verified, last_verified_slot, nullifier, region_id }`. Declared program id (devnet): `56qEvUYQnhfEf557ftLVdjtwqfJA6TpG2cnru3MyhT7Z`.

- `programs/hyperlocal_markets` (Anchor)  
  Dynamic Pari-Mutuel (square-root DPM) YES/NO markets gated by region. PDAs:
  - `Market` PDA seeds: `["market", creator, keccak(question)]`
  - `UserPosition` PDA seeds: `["user-position", market, user]`
  - Vault ATA owned by `Market` PDA holds USDC.
  Features: slippage check, claim, emergency withdraw (if no winning-side liquidity), keccak question hash to avoid seed collisions. Resolution layer fields mirror into `resolved: bool` and `outcome: u8`.
  Declared program id (devnet): `EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox`.

- Frontend (root Next app)  
  - Wallet: Phantom via `@solana/wallet-adapter` (Devnet endpoint).
  - Location: browser geolocation → `snarkjs.groth16.fullProve` with circuit artifacts in `public/zk/`.
  - Proof submit: calls `zk_location_verifier::submit_location_proof`.
  - Trading: reads markets on-chain, calls `hyperlocal_markets::place_order` with `min_shares_out` slippage.

- Agent (`scripts/run_agent.ts`)  
  Off-chain resolver using Tavily/SerpAPI + Gemini/OpenAI (depending on env) to search the web and propose outcomes via `agent_attempt_resolution`. Maps UNSURE → `OUTCOME_NONE` (disputed), YES/NO with confidence ≥ 0.9 → finalize on-chain. Manifests load from URL or `manifests/` folder; integrity can be checked against `manifest_hash`.

- Smoke / tests (`scripts/devnet_smoke.ts`, `scripts/test_resolver.ts`)  
  Helpers to create a market on devnet, sanity-check resolution calls, and exercise the agent locally.

---

## How the ZK location proof flows

1) Browser collects geolocation (or fallback) and scales coords to field elements.  
2) `snarkjs.groth16.fullProve` runs against `spatial_check.wasm`/`spatial_check_final.zkey`.  
3) `zkProver.js` packs proof/public inputs as 32-byte big-endian limbs: `[min_lat, max_lat, min_lon, max_lon]`.  
4) `zkLocationClient.ts` builds the instruction manually (Anchor discriminator + bytes) and sends to `zk_location_verifier`.  
5) On-chain verifier checks Groth16 against embedded VK. On success, writes `UserLocationState` PDA for the signer with `region_id` derived from inputs.

Important: the on-chain verifying key must match the `.zkey` used by the frontend. If you regenerate the circuit/zkey, re-run `node circuits/scripts/export_vk_to_rust.js`, rebuild, and redeploy.

---

## On-chain programs (details)

### zk_location_verifier
- Instruction: `init_config` (creates config PDA, currently unused for VK storage).
- Instruction: `submit_location_proof(proof, public_inputs)`  
  Verifies Groth16, derives `region_id` from bounding-box inputs, and sets `UserLocationState` PDA for the signer.
- Accounts:
  - `UserLocationState`: PDA `["user-state", user]`
  - `Config`: PDA `["config"]` (bump stored)
- Errors: `InvalidProof` (6000).

### hyperlocal_markets
- Instruction: `create_market(region_id, question, close_time, manifest_url, manifest_hash)`  
  Seeds market PDA with keccak(question). Sets priors (yes/no = 1), links USDC mint, resolver, manifest metadata.
- Instruction: `place_order(amount, side, min_shares_out)`  
  Requires `UserLocationState.is_verified` and matching `region_id`. Square-root DPM math; enforces slippage.
- Instruction: `resolve_market(outcome)` (resolver authority) — legacy/simple path.
- Instruction: `agent_attempt_resolution(outcome, evidence, reason)`  
  AI agent can set `agent_outcome`; YES/NO finalizes `resolved/outcome`, UNSURE marks `Disputed`.
- Instruction: `creator_resolve_market(outcome, evidence)`  
  Creator override; always mirrors into canonical `resolved/outcome`.
- Instruction: `claim`  
  Pari-mutuel payout: `user_shares / winning_total * total_pool`, transfers USDC from vault.
- Instruction: `emergency_withdraw`  
  Resolver can withdraw vault if winning side had no real liquidity (≤ dust).
- PDAs:
  - `Market`: seeds `["market", creator, keccak(question)]`
  - `UserPosition`: seeds `["user-position", market, user]`
  - Vault ATA: associated to `Market` PDA for USDC mint.
- Constants:
  - `OUTCOME_NONE=0`, `OUTCOME_YES=1`, `OUTCOME_NO=2`
  - `ResolutionStatus`: Open/Disputed/Resolved
- Errors: slippage exceeded, wrong region, unauthorized resolver/creator, already resolved/claimed, math overflow/underflow, no winning liquidity.

---

## Frontend (root Next app)

- Connect wallet (Phantom; autoConnect disabled to avoid hanging when extension is missing).
- Detects region via browser geolocation, defaults to predefined regions for demo.
- Generates ZK proof, submits to verifier, saves `UserLocationState` PDA.
- Fetches on-chain markets and lets user trade YES/NO with slippage input.
- Uses `NEXT_PUBLIC_RPC_URL` (default devnet) for reads/writes.

Artifacts required under `public/zk/`:
- `spatial_check_js/spatial_check.wasm`
- `spatial_check_final.zkey`
- `snarkjs.min.js`

Ensure the WASM file is a real file (not a symlink) to avoid `ELOOP` errors.

---

## Agent (off-chain resolver)

`scripts/run_agent.ts`:
- Reads markets (status ≠ Resolved, close_time < now).
- Loads `ResolutionManifest` (type in `app/types/manifest.ts`).
- Searches web via Tavily or SerpAPI; calls Gemini/OpenAI to apply `validation_rules`.
- Maps:
  - YES → `OUTCOME_YES`
  - NO → `OUTCOME_NO`
  - UNSURE → `OUTCOME_NONE` (marks Disputed)
- Calls `agent_attempt_resolution` with evidence URL/reason.

Env vars (agent):
- `RPC_URL` (e.g., https://api.devnet.solana.com)
- `RESOLVER_KEYPAIR` (path to keypair JSON)
- `HYPERLOCAL_MARKETS_PROGRAM_ID`
- `GEMINI_API_KEY`
- `TAVILY_API_KEY`

Run with ts-node using `tsconfig.scripts.json`, e.g.:
```bash
npx ts-node --project tsconfig.scripts.json scripts/run_agent.ts
```

---

## Scripts

- `scripts/devnet_smoke.ts` – creates a market on devnet, checks PDAs/status.
- `scripts/test_resolver.ts` – local harness to test `resolveMarketLogic`.
- `circuits/scripts/*.sh/js` – setup, compile, export VK to Rust.

---

## Building & deploying

Circuits:
```bash
cd circuits
./scripts/setup.sh
./scripts/compile.sh
node scripts/export_vk_to_rust.js   # refresh verifying_key.rs after circuit changes
```

Programs:
```bash
anchor build --no-idl
# Anchor.toml has devnet/localnet program IDs; update if you redeploy.
anchor deploy --program-name zk_location_verifier
anchor deploy --program-name hyperlocal_markets
```

Frontend (outer Next app):
```bash
cd app/web   # if you run the inner app
npm install
npm run dev
```
If you run the outer app (repo root), clean `.next` in both root and `app/web` to avoid conflicts, and tighten Tailwind content globs to avoid scanning `app/web/**` unless needed.

---

## Env vars (frontend)

Create `.env` in the app directory:
```
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_HYPERLOCAL_PROGRAM_ID=EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox
NEXT_PUBLIC_ZK_LOCATION_PROGRAM_ID=56qEvUYQnhfEf557ftLVdjtwqfJA6TpG2cnru3MyhT7Z
```
Add your wallet adapter requirements (Phantom) in the browser; no MetaMask support.

---

## Repo layout

- `circuits/` – Circom circuit, proving artifacts, VK export script.
- `programs/zk_location_verifier/` – On-chain Groth16 verifier (BN254).
- `programs/hyperlocal_markets/` – DPM markets + resolution layer + ZK gating.
- `app/` – Root Next frontend (trading UI, proof generation).
- `scripts/` – Agent, smoke tests, resolver harness, deploy helpers.
- `docs/` – Architecture deep dive.
