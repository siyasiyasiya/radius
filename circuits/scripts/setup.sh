#!/usr/bin/env bash
set -euo pipefail

# Download a small Powers of Tau file for Groth16. You can swap in a larger ptau if needed.
# If network access is restricted, place the file manually at powersOfTau28_hez_final_12.ptau.

PTAU="powersOfTau28_hez_final_12.ptau"

if [ -f "$PTAU" ]; then
  echo "[setup] Found $PTAU; skipping download."
else
  echo "[setup] Downloading $PTAU..."
  curl -L "https://hermez.s3-eu-west-1.amazonaws.com/$PTAU" -o "$PTAU"
fi

echo "[setup] Done."
