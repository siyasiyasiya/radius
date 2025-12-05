#!/usr/bin/env node
// Convert snarkjs verification_key.json to groth16-solana Rust format

const fs = require('fs');
const path = require('path');

const vkPath = path.join(__dirname, '..', 'circuits', 'verification_key.json');
const vk = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

// Convert to little-endian for groth16-solana
function toBytesLE(decStr) {
  let bn = BigInt(decStr);
  const bytes = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(Number(bn & 0xFFn));
    bn >>= 8n;
  }
  return bytes;
}

// Format bytes as Rust array
function formatBytes(bytes) {
  return '[' + bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ') + ']';
}

// Concatenate G1 point to 64 bytes
function concatG1(point) {
  const x = toBytesLE(point[0]);
  const y = toBytesLE(point[1]);
  return [...x, ...y];
}

// Format G1 for inline
function formatG1(point) {
  const x = toBytesLE(point[0]);
  const y = toBytesLE(point[1]);
  return { x: formatBytes(x), y: formatBytes(y) };
}

// Format G2 point (2x2 coordinates) - note the swap for groth16-solana
function formatG2(point) {
  // groth16-solana expects G2 coordinates swapped within each pair
  const x0 = toBytesLE(point[0][0]);
  const x1 = toBytesLE(point[0][1]);
  const y0 = toBytesLE(point[1][0]);
  const y1 = toBytesLE(point[1][1]);
  return {
    x: `[\n        ${formatBytes(x1)},\n        ${formatBytes(x0)},\n    ]`,
    y: `[\n        ${formatBytes(y1)},\n        ${formatBytes(y0)},\n    ]`
  };
}

// Generate Rust code
const alpha = formatG1(vk.vk_alpha_1);
const beta = formatG2(vk.vk_beta_2);
const gamma = formatG2(vk.vk_gamma_2);
const delta = formatG2(vk.vk_delta_2);

// IC points as concatenated 64-byte arrays
const icCount = vk.IC.length;

let rustCode = `use groth16_solana::groth16::Groth16Verifyingkey;

fn concat_g1(x: &[u8; 32], y: &[u8; 32]) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(x);
    out[32..].copy_from_slice(y);
    out
}

fn concat_g2(x: &[[u8; 32]; 2], y: &[[u8; 32]; 2]) -> [u8; 128] {
    let mut out = [0u8; 128];
    out[..32].copy_from_slice(&x[0]);
    out[32..64].copy_from_slice(&x[1]);
    out[64..96].copy_from_slice(&y[0]);
    out[96..].copy_from_slice(&y[1]);
    out
}

// Verifying key generated from circuits/verification_key.json
pub fn verifying_key<'a>() -> Groth16Verifyingkey<'a> {
    // Alpha G1
    const ALPHA_G1_X: [u8; 32] = ${alpha.x};
    const ALPHA_G1_Y: [u8; 32] = ${alpha.y};

    // Beta G2
    const BETA_G2_X: [[u8; 32]; 2] = ${beta.x};
    const BETA_G2_Y: [[u8; 32]; 2] = ${beta.y};

    // Gamma G2
    const GAMMA_G2_X: [[u8; 32]; 2] = ${gamma.x};
    const GAMMA_G2_Y: [[u8; 32]; 2] = ${gamma.y};

    // Delta G2
    const DELTA_G2_X: [[u8; 32]; 2] = ${delta.x};
    const DELTA_G2_Y: [[u8; 32]; 2] = ${delta.y};

    // IC (public input commitments) - ${icCount} points
    const IC: [[u8; 64]; ${icCount}] = [
`;

// Add IC points as 64-byte arrays
for (let i = 0; i < icCount; i++) {
  const icBytes = concatG1(vk.IC[i]);
  rustCode += `        ${formatBytes(icBytes)},\n`;
}

rustCode += `    ];

    Groth16Verifyingkey {
        nr_pubinputs: ${vk.nPublic},
        vk_alpha_g1: concat_g1(&ALPHA_G1_X, &ALPHA_G1_Y),
        vk_beta_g2: concat_g2(&BETA_G2_X, &BETA_G2_Y),
        vk_gamme_g2: concat_g2(&GAMMA_G2_X, &GAMMA_G2_Y),
        vk_delta_g2: concat_g2(&DELTA_G2_X, &DELTA_G2_Y),
        vk_ic: &IC,
    }
}
`;

// Write output
const outPath = path.join(__dirname, '..', 'programs', 'zk_location_verifier', 'src', 'verifying_key.rs');
fs.writeFileSync(outPath, rustCode);
console.log('Generated:', outPath);
