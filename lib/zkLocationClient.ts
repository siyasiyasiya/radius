// lib/zkLocationClient.ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

export const ZK_LOCATION_PROGRAM_ID = new PublicKey(
  "56qEvUYQnhfEf557ftLVdjtwqfJA6TpG2cnru3MyhT7Z"
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

  console.log("Building transaction...");
  console.log("User state PDA:", userStatePda.toBase58());
  console.log("Program ID:", ZK_LOCATION_PROGRAM_ID.toBase58());

  const data = buildSubmitLocationProofData(proofPacked, publicInputsPacked);
  console.log("Instruction data length:", data.length);

  const keys = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: userStatePda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: ZK_LOCATION_PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  
  // Set required transaction fields
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  console.log("Transaction built, sending to wallet...");
  console.log("Blockhash:", blockhash);

  // First simulate the transaction to get better error messages
  try {
    const simulation = await connection.simulateTransaction(tx);
    console.log("Simulation result:", simulation);
    if (simulation.value.err) {
      console.error("Simulation failed:", simulation.value.err);
      console.error("Simulation logs:", simulation.value.logs);
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
  } catch (simError: any) {
    console.error("Simulation error:", simError);
    // Continue anyway - simulation might fail but tx might succeed
  }

  const txSig = await wallet.sendTransaction(tx, connection);
  console.log("Transaction sent:", txSig);
  
  // Wait for confirmation
  await connection.confirmTransaction({
    signature: txSig,
    blockhash,
    lastValidBlockHeight,
  });

  console.log("Transaction confirmed!");
  return { txSig, userStatePda };
}
