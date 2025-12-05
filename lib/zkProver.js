const SCALE = 1_000_000n;

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

function packProof(proof) {
  return {
    proof_a: [toBytes32(proof.pi_a[0]), toBytes32(proof.pi_a[1])],
    proof_b: [
      [toBytes32(proof.pi_b[0][0]), toBytes32(proof.pi_b[0][1])],
      [toBytes32(proof.pi_b[1][0]), toBytes32(proof.pi_b[1][1])],
    ],
    proof_c: [toBytes32(proof.pi_c[0]), toBytes32(proof.pi_c[1])],
  };
}

function packPublicSignals(publicSignals) {
  console.log("publicSignals:", publicSignals);

  if (!Array.isArray(publicSignals) || publicSignals.length < 5) {
    throw new Error("Unexpected publicSignals from circuit");
  }

  const [
    _unused0,
    minLat,
    maxLat,
    minLon,
    maxLon,
  ] = publicSignals;

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
