# ZK Location Proof Blueprint (Hackathon Edition)

This document condenses the location-proof blueprint into actionable pieces for this repo. It mirrors the feedback outline: clear threat model, BN254/Groth16 choices, and pragmatic scope.

## Threat model

- We only prove: the provided `(lat, lon)` is within `radius` of `target`.
- We do **not** prove GPS authenticity. Spoofing is out of scope for v1. Future work: TLSNotary/Reclaim or secure-hardware-signed GPS.

## Circuit (Circom)

`circuits/spatial_check.circom`:

- Inputs:
  - Private: `userLat`, `userLon`, `salt`.
  - Public: `targetLat`, `targetLon`, `radiusSq`, `locationNullifier`.
- Logic:
  - Scale coords to integers (e.g., degrees * 1e6).
  - Compute `distSq = (lat - targetLat)^2 + (lon - targetLon)^2`.
  - Enforce `distSq <= radiusSq` via `LessEqThan`.
  - `locationNullifier = Poseidon(userLat, userLon, salt)`.
- Public signal order: `[targetLat, targetLon, radiusSq, locationNullifier]`.

## On-chain verifier (Anchor + groth16-solana)

- BN254/alt_bn128 syscalls available in Solana 1.18+ keep Groth16 verification under ~200k CUs.
- Store the verifying key in a PDA (`Config`). Use `init_config` once, then verify proofs via `submit_location_proof`.
- User PDA `UserLocationState` stores `is_verified`, `last_verified_slot`, `nullifier`, `region_id`.
- `region_id` can be Poseidon of `(targetLat, targetLon, radiusMeters)`.

## Market program (Anchor)

- `Market` holds `region_id`, `question`, `close_time`, `resolved`, `outcome`.
- `place_order` checks the PDA from the verifier:
  - `user_location.region_id == market.region_id`
  - `user_location.is_verified == true`

## Client (web)

- Browser uses `snarkjs.groth16.fullProve` with `spatial_check.wasm` and `spatial_check_final.zkey`.
- After proof, it flattens public signals, serializes to big-endian `u8;32` arrays, and calls `submit_location_proof` via Anchor/web3.js.
- Post-verification, it calls `place_order` on the market program.

## Workflow

1. `circom` compile → `.r1cs` + `.wasm`.
2. `snarkjs groth16 setup` → `.zkey`.
3. Export VK to Rust via `circuits/scripts/export_vk_to_rust.js`.
4. `anchor build` & deploy.
5. Browser: collect GPS, prove, submit.

## Geometry note

We approximate Earth locally: `1° ≈ 111km`, use Euclidean distance in scaled degrees for city/venue scale. Good enough for coarse region gating.
