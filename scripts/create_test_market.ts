/**
 * Create a test market that expires soon for testing the oracle.
 * Run with: npx ts-node scripts/create_test_market.ts
 */
import fs from "fs";
import path from "path";
import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { keccak256 } from "js-sha3";

const hyperlocalIdlPath = path.resolve(process.cwd(), "target/idl/hyperlocal_markets.json");
const hyperlocalIdl = JSON.parse(fs.readFileSync(hyperlocalIdlPath, "utf8")) as anchor.Idl;

const PROGRAM_ID = new PublicKey(
  process.env.HYPERLOCAL_MARKETS_PROGRAM_ID ?? "EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox"
);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.RESOLVER_KEYPAIR ?? 
  path.join(process.env.HOME || ".", ".config", "solana", "id.json");

// Your USDC mint
const USDC_MINT = new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function questionHash(question: string): number[] {
  const hash = keccak256(question);
  return Array.from(Buffer.from(hash, "hex"));
}

function regionIdFromName(name: string): number[] {
  const hash = keccak256(name);
  return Array.from(Buffer.from(hash, "hex"));
}

function hashManifest(manifest: object): number[] {
  const json = JSON.stringify(manifest);
  const hash = keccak256(json);
  return Array.from(Buffer.from(hash, "hex"));
}

async function main() {
  const keypair = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(hyperlocalIdl, provider);

  // Load manifest
  const manifestPath = path.resolve(process.cwd(), "manifests/example_weather.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  
  const question = manifest.title;
  const regionName = "UMich"; // Use one of your regions
  
  // Close time: 1 minute from now (for quick testing)
  const closeTime = Math.floor(Date.now() / 1000) + 60;
  
  const regionId = regionIdFromName(regionName);
  const qHash = questionHash(question);
  const manifestHash = hashManifest(manifest);

  // Derive PDAs
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), keypair.publicKey.toBuffer(), Buffer.from(qHash)],
    PROGRAM_ID
  );
  
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    PROGRAM_ID
  );

  console.log("📊 Creating test market...");
  console.log("  Question:", question);
  console.log("  Region:", regionName);
  console.log("  Close Time:", new Date(closeTime * 1000).toISOString());
  console.log("  Manifest URL:", manifestPath);
  console.log("  Market PDA:", marketPda.toBase58());

  try {
    const tx = await program.methods
      .createMarket(
        regionId,
        question,
        new anchor.BN(closeTime),
        manifestPath, // URL or local path
        manifestHash
      )
      .accounts({
        payer: keypair.publicKey,
        market: marketPda,
        vault: vaultPda,
        usdcMint: USDC_MINT,
        resolver: keypair.publicKey, // You are the resolver for testing
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([keypair])
      .rpc();

    console.log("✅ Market created!");
    console.log("  Tx:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    console.log("\n⏳ Wait 1 minute, then run the oracle agent:");
    console.log("  npx ts-node scripts/run_agent.ts");
  } catch (e) {
    console.error("❌ Failed to create market:", e);
  }
}

main().catch(console.error);
