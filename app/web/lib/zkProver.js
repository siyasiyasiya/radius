const SCALE = 1_000_000n; // degrees * 1e6 -> integer field
const METERS_PER_DEGREE = 111_000;

function toBigInt(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.round(v));
  return BigInt(v);
}

function scaleCoord(deg) {
  return toBigInt(Math.round(deg * Number(SCALE)));
}

function degreeRadiusSq(radiusMeters) {
  const degree = radiusMeters / METERS_PER_DEGREE;
  const scaled = Math.round(degree * Number(SCALE));
  const sq = BigInt(scaled) * BigInt(scaled);
  return sq;
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
  return {
    min_lat: toBytes32(publicSignals[0]),
    max_lat: toBytes32(publicSignals[1]),
    min_lon: toBytes32(publicSignals[2]),
    max_lon: toBytes32(publicSignals[3]),
  };
}

export async function proveLocation({ userLat, userLon, minLat, maxLat, minLon, maxLon, salt }) {
  if (typeof window === "undefined" || !window.snarkjs) {
    throw new Error("snarkjs not loaded. It is injected via <Script src='/zk/snarkjs.min.js' />");
  }
  const cacheBuster = "v=5";
  const wasm = `/zk/spatial_check_js/spatial_check.wasm?${cacheBuster}`;
  const zkey = `/zk/spatial_check_final.zkey?${cacheBuster}`;

  const scaledUserLat = scaleCoord(userLat);
  const scaledUserLon = scaleCoord(userLon);
  const saltBig = toBigInt(salt ?? 0);

  const input = {
    userLat: scaledUserLat.toString(),
    userLon: scaledUserLon.toString(),
    minLat: scaleCoord(minLat).toString(),
    maxLat: scaleCoord(maxLat).toString(),
    minLon: scaleCoord(minLon).toString(),
    maxLon: scaleCoord(maxLon).toString(),
    salt: saltBig.toString(),
  };

  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(input, wasm, zkey);
  return {
    proofPacked: packProof(proof),
    publicInputsPacked: packPublicSignals(publicSignals),
    rawPublicSignals: publicSignals,
    input,
  };
}
