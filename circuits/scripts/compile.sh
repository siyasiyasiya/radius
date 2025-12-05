#!/usr/bin/env bash
set -euo pipefail

CIRCUIT="spatial_check"
PTAU="powersOfTau28_hez_final_12.ptau"

if [ ! -f "$PTAU" ]; then
  echo "[compile] Missing $PTAU. Run scripts/setup.sh first." >&2
  exit 1
fi

echo "[compile] Compiling $CIRCUIT.circom..."
/Users/neenanaikar/.cargo/bin/circom "$CIRCUIT.circom" --r1cs --wasm --sym

echo "[compile] Running Groth16 setup..."
npx snarkjs groth16 setup "$CIRCUIT.r1cs" "$PTAU" "${CIRCUIT}_0000.zkey"

echo "[compile] Contributing beacon..."
npx snarkjs zkey beacon "${CIRCUIT}_0000.zkey" "${CIRCUIT}_final.zkey" 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10

echo "[compile] Exporting verification key..."
npx snarkjs zkey export verificationkey "${CIRCUIT}_final.zkey" verification_key.json

echo "[compile] Done. Artifacts: ${CIRCUIT}.r1cs, ${CIRCUIT}.wasm, ${CIRCUIT}_final.zkey, verification_key.json"
