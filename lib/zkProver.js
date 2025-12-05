const SCALE = 1_000_000n;

// BN254 base field modulus (for negating G1 y-coordinate)
const BN254_FIELD_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function toBigInt(v) {
  if (v === undefined || v === null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.round(v));
  return BigInt(v);
}

function scaleCoord(deg) {
  return toBigInt(Math.round(deg * Number(SCALE)));
}

function toBytes32(fieldStr) {
  const v = BigInt(fieldStr);
  let hex = v.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || [];
  const padded = Array(32 - bytes.length).fill(0).concat(bytes);
  return padded;
}

// Negate a G1 point's y-coordinate for Groth16 verification
// groth16-solana expects proof_a to be negated
function negateG1Y(yStr) {
  const y = BigInt(yStr);
  const yNeg = BN254_FIELD_MODULUS - y;
  return yNeg.toString();
}

function packProof(proof) {
  // proof_a needs to be negated (negate the y-coordinate) for groth16-solana verification
  // proof_b (G2 point) needs ordering: [x1, x0, y1, y0] to match groth16-solana format
  return {
    proof_a: [toBytes32(proof.pi_a[0]), toBytes32(negateG1Y(proof.pi_a[1]))],
    proof_b: [
      // G2 uses [x1, x0, y1, y0] ordering
      [toBytes32(proof.pi_b[0][1]), toBytes32(proof.pi_b[0][0])],
      [toBytes32(proof.pi_b[1][1]), toBytes32(proof.pi_b[1][0])],
    ],
    proof_c: [toBytes32(proof.pi_c[0]), toBytes32(proof.pi_c[1])],
  };
}

function packPublicSignals(publicSignals) {
  console.log("publicSignals:", publicSignals);

  // The circuit has 4 public inputs: minLat, maxLat, minLon, maxLon
  // The locationNullifier output is NOT public, so publicSignals only contains the 4 inputs
  if (!Array.isArray(publicSignals) || publicSignals.length < 4) {
    throw new Error(`Unexpected publicSignals from circuit: got ${publicSignals?.length || 0} signals, expected 4`);
  }

  const [minLat, maxLat, minLon, maxLon] = publicSignals;

  console.log("Parsed signals:", { minLat, maxLat, minLon, maxLon });

  return {
    // field names must match the Rust struct / IDL exactly
    min_lat: toBytes32(minLat),
    max_lat: toBytes32(maxLat),
    min_lon: toBytes32(minLon),
    max_lon: toBytes32(maxLon),
  };
}


export async function proveLocation({ userLat, userLon, minLat, maxLat, minLon, maxLon, salt }) {
  if (typeof window === "undefined" || !window.snarkjs) {
    throw new Error("snarkjs not loaded");
  }
  
  const wasm = `/zk/spatial_check_js/spatial_check.wasm`;
  const zkey = `/zk/spatial_check_final.zkey`;

  const input = {
    userLat: scaleCoord(userLat).toString(),
    userLon: scaleCoord(userLon).toString(),
    minLat: scaleCoord(minLat).toString(),
    maxLat: scaleCoord(maxLat).toString(),
    minLon: scaleCoord(minLon).toString(),
    maxLon: scaleCoord(maxLon).toString(),
    salt: toBigInt(salt || 0).toString(),
  };

  console.log("Generating proof with input:", input);
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(input, wasm, zkey);
  
  return {
    proofPacked: packProof(proof),
    publicInputsPacked: packPublicSignals(publicSignals),
    rawPublicSignals: publicSignals,
    input,
  };
}
