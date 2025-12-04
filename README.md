# Local Prediction Markets with ZK Location Proofs

This repo sketches a hackathon-ready stack for **zk-gated local prediction markets on Solana**. It includes:

- A Circom circuit that proves `distance(user, target) <= radius`.
- An Anchor program that verifies Groth16 proofs on-chain (BN254 syscalls).
- A stub prediction-market program that enforces location membership.
- A lightweight web page to generate a proof with `snarkjs` and submit it.

For the full rationale and design notes, see `docs/zk-location-architecture.md`.

## Repo layout

- `circuits/` – `spatial_check.circom`, setup/compile scripts, VK export.
- `programs/zk_location_verifier/` – Anchor + `groth16-solana` verifier.
- `programs/hyperlocal_markets/` – Prediction market stub reading location PDAs.
- `app/web/` – Static page that proves and submits a location proof.
- `scripts/` – Localnet/deploy helpers (stubs).

## Quickstart (outline)

1) Install deps: `circom`, `snarkjs`, `anchor-cli`, Rust nightly (for Solana).  
2) Build circuit:
   ```bash
   cd circuits
   ./scripts/setup.sh      # downloads ptau (or provide your own)
   ./scripts/compile.sh    # builds wasm/r1cs/zkey + verification_key.json
   node scripts/export_vk_to_rust.js
   ```
3) Build programs:
   ```bash
   anchor build
   ```
4) Serve web page (needs `snarkjs` bundle placed at `app/web/lib/snarkjs.min.js`):
   ```bash
   cd app/web
   python3 -m http.server 3000
   ```
5) In browser, click **Generate proof & submit** after filling coords; it runs `snarkjs.groth16.fullProve` with the circuit artifacts in `app/web/lib/`.

## Notes

- The verifier expects public signals ordered as `[targetLat, targetLon, radiusSq, locationNullifier]`.
- Everything assumes Solana 1.18+ (BN254 syscalls). Adjust if you target older clusters.
- Artifacts (`.zkey`, `.wasm`) are not committed; generate them locally for your region/radius.
