/**
 * E2E SMOKE TEST (Devnet)
 * Fixes: Argument order, Account constraints, PDA derivation, Status enums.
 * Run: npx ts-node scripts/devnet_smoke.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { keccak_256 } from "@noble/hashes/sha3";
import * as anchor from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  Connection, 
  SystemProgram, 
  SYSVAR_RENT_PUBKEY 
} from "@solana/web3.js";

// --- CONFIGURATION ---
const PROGRAM_ID = new PublicKey(
  process.env.HYPERLOCAL_MARKETS_PROGRAM_ID ?? 
  "EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox"
);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const RESOLVER_KEYPAIR_PATH = process.env.RESOLVER_KEYPAIR ?? path.join(process.env.HOME || ".", ".config", "solana", "id.json");

// Devnet USDC Mint (Standard Devnet faucet mint)
// If this fails, replace with a mint you created: spl-token create-token
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// Load IDL
const hyperlocalIdlPath = path.resolve(process.cwd(), "target/idl/hyperlocal_markets.json");
const hyperlocalIdl = JSON.parse(fs.readFileSync(hyperlocalIdlPath, "utf8")) as anchor.Idl;

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  console.log("🚀 STARTING DEVNET SMOKE TEST (FIXED)\n");

  // 1. SETUP
  const connection = new Connection(RPC_URL, "confirmed");
  const resolverKp = loadKeypair(RESOLVER_KEYPAIR_PATH);
  // Using resolver as the creator/payer for simplicity
  const wallet = new anchor.Wallet(resolverKp);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(hyperlocalIdl, provider);

  console.log(`   Wallet: ${resolverKp.publicKey.toBase58()}`);
  console.log(`   Program: ${PROGRAM_ID.toBase58()}`);

  // 2. PREPARE DATA
  const question = `Will it rain in smoke-test-city on ${Date.now()}?`;
  const regionId = new Uint8Array(32); // 32-byte generic region ID
  regionId.set(Buffer.from("NA-US-IL"), 0);     // Example data

  const manifestUrl = "https://gateway.pinata.cloud/ipfs/QmExampleManifestHash";
  const manifestHash = new Uint8Array(
    keccak_256(new TextEncoder().encode("mock-manifest-content"))
  ); // 32 bytes
  
  // Close time: already expired so agent can resolve immediately
  const closeTime = new anchor.BN(Math.floor(Date.now() / 1000) - 60);

  // 3. DERIVE PDAs (Critical Fix)
  // Seeds: [b"market", payer, question_hash]
  
  // a. Hash the question string using keccak to match on-chain question_hash
  const questionHash = new Uint8Array(
    keccak_256(new TextEncoder().encode(question))
  );

  const [marketPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      resolverKp.publicKey.toBuffer(),
      questionHash, 
    ],
    PROGRAM_ID
  );

  // Load spl-token dynamically to avoid ESM/CJS issues
  const spl = await import("@solana/spl-token");
  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = spl;

  // b. Derive Vault ATA (Associated Token Account for the Market PDA)
  const vaultPda = getAssociatedTokenAddressSync(
    USDC_MINT,
    marketPda,
    true // allowOwnerOffCurve = true (since owner is a PDA)
  );

  console.log(`   Market PDA: ${marketPda.toBase58()}`);
  console.log(`   Vault PDA:  ${vaultPda.toBase58()}`);

  // 4. CREATE MARKET (Fixed Order & Accounts)
  console.log("\n1️⃣  Creating Market...");

  try {
    // Rust Signature: (region_id, question, close_time, manifest_url, manifest_hash)
    const tx = await program.methods
      .createMarket(
        Array.from(regionId),   // region_id (array of numbers)
        question,        // question
        closeTime,       // close_time
        manifestUrl,     // manifest_url
        Array.from(manifestHash)// manifest_hash
      )
      .accounts({
        payer: resolverKp.publicKey,
        market: marketPda,
        usdcMint: USDC_MINT,
        vault: vaultPda,
        resolver: resolverKp.publicKey, // Setting ourself as resolver
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([resolverKp])
      .rpc();

    console.log(`   ✅ Transaction Sent! https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (e) {
    console.error("❌ Creation Failed:", e);
    return;
  }

  // 5. VERIFY STATE (Fixed Enum Check)
  console.log("\n2️⃣  Verifying State...");
  // Wait 2s for confirmation
  await new Promise(r => setTimeout(r, 2000));

  try {
    const account: any = await program.account["market"].fetch(marketPda);
    const status = account.status as any;
    if ("open" in status) {
      console.log(`   ✅ Market Status is OPEN`);
    } else if ("disputed" in status) {
      console.log(`   ⚠️ Market Status is DISPUTED`);
    } else if ("resolved" in status) {
      console.log(`   ⚠️ Market Status is RESOLVED`);
    } else {
      console.error(`   ❌ Unexpected Status: ${JSON.stringify(account.status)}`);
    }

    // Verify fields match
    if (account.question === question) {
      console.log(`   ✅ Question matches.`);
    } else {
      console.error(`   ❌ Question mismatch.`);
    }

  } catch (e) {
    console.error("   ❌ Failed to fetch market account:", e);
  }

  console.log("\n✨ SMOKE TEST COMPLETE.");
}

main().catch(console.error);
