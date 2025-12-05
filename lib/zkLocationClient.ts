// lib/zkLocationClient.ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

export const ZK_LOCATION_PROGRAM_ID = new PublicKey(
  "Hr7Wh6PHTsS7e74HQWtafBjNhj9egXQgAM9yeWSnwsDD"
);

// From IDL: discriminator for submit_location_proof
const SUBMIT_LOCATION_PROOF_DISCRIMINATOR = new Uint8Array([
  146, 106, 119, 160, 143, 248, 72, 122,
]);

function getConnection(): Connection {
  return new Connection("https://api.devnet.solana.com", "confirmed");
}

function encodeProof(proofPacked: any): number[] {
  const out: number[] = [];

  const pushBytes32 = (arr: number[]) => {
    if (!Array.isArray(arr) || arr.length !== 32) {
      throw new Error("Expected bytes32 (array of length 32)");
    }
    for (const b of arr) out.push(b);
  };

  pushBytes32(proofPacked.proof_a[0]);
  pushBytes32(proofPacked.proof_a[1]);
  pushBytes32(proofPacked.proof_b[0][0]);
  pushBytes32(proofPacked.proof_b[0][1]);
  pushBytes32(proofPacked.proof_b[1][0]);
  pushBytes32(proofPacked.proof_b[1][1]);
  pushBytes32(proofPacked.proof_c[0]);
  pushBytes32(proofPacked.proof_c[1]);

  return out;
}

function encodePublicInputs(publicInputsPacked: any): number[] {
  const out: number[] = [];

  const pushBytes32 = (arr: number[]) => {
    if (!Array.isArray(arr) || arr.length !== 32) {
      throw new Error("Expected bytes32 (array of length 32)");
    }
    for (const b of arr) out.push(b);
  };

  pushBytes32(publicInputsPacked.min_lat);
  pushBytes32(publicInputsPacked.max_lat);
  pushBytes32(publicInputsPacked.min_lon);
  pushBytes32(publicInputsPacked.max_lon);

  return out;
}

function buildSubmitLocationProofData(
  proofPacked: any,
  publicInputsPacked: any
): Uint8Array {
  const proofBytes = encodeProof(proofPacked);
  const inputsBytes = encodePublicInputs(publicInputsPacked);

  const totalLen =
    SUBMIT_LOCATION_PROOF_DISCRIMINATOR.length +
    proofBytes.length +
    inputsBytes.length;

  const data = new Uint8Array(totalLen);
  let offset = 0;

  data.set(SUBMIT_LOCATION_PROOF_DISCRIMINATOR, offset);
  offset += SUBMIT_LOCATION_PROOF_DISCRIMINATOR.length;

  data.set(new Uint8Array(proofBytes), offset);
  offset += proofBytes.length;

  data.set(new Uint8Array(inputsBytes), offset);

  return data;
}

export async function submitLocationProof(
  wallet: any,
  proofPacked: any,
  publicInputsPacked: any
): Promise<{ txSig: string; userStatePda: PublicKey }> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  const connection = getConnection();

  const [userStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user-state"), wallet.publicKey.toBuffer()],
    ZK_LOCATION_PROGRAM_ID
  );

  const data = buildSubmitLocationProofData(proofPacked, publicInputsPacked);

  const keys = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: userStatePda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: ZK_LOCATION_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);

  const txSig = await wallet.sendTransaction(tx, connection);

  return { txSig, userStatePda };
}
