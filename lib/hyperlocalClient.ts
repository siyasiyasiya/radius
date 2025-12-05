import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import hyperlocalIdl from "../target/idl/hyperlocal_markets.json";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
// @ts-ignore - no types available
import { keccak_256 } from "js-sha3";

// Devnet program ID (must match declare_id! and Anchor.toml)
export const HYPERLOCAL_PROGRAM_ID = new PublicKey(
  "EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox"
);

// Devnet USDC mint
export const USDC_MINT = new PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
);

// Compatible wallet type for browser wallet adapters
export interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export type MarketAccount = {
  publicKey: PublicKey;
  question: string;
  regionId: number[];
  status: any;
  resolved: boolean;
  outcome: number;
  closeTime: number;
};

export function getProgram(connection: Connection, wallet: AnchorWallet) {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  
  // Create program with IDL and provider (new Anchor API)
  const idl = hyperlocalIdl as anchor.Idl;
  return new anchor.Program(idl, provider);
}

export async function fetchMarkets(
  connection: Connection,
  wallet: AnchorWallet
): Promise<MarketAccount[]> {
  const program = getProgram(connection, wallet);
  // Use bracket notation for dynamic account access
  const accounts = await (program.account as any).market.all();
  return accounts.map((m: any) => ({
    publicKey: m.publicKey as PublicKey,
    question: m.account.question as string,
    regionId: Array.from(m.account.regionId as number[]),
    status: m.account.status,
    resolved: m.account.resolved as boolean,
    outcome: m.account.outcome as number,
    closeTime:
      typeof m.account.closeTime === "number"
        ? (m.account.closeTime as number)
        : (m.account.closeTime as anchor.BN).toNumber(),
  }));
}

export async function placeOrderOnChain(params: {
  connection: Connection;
  wallet: AnchorWallet;
  market: PublicKey;
  userLocation: PublicKey;
  amount: number; // in USDC base units (e.g., 1 USDC = 1_000_000)
  side: "yes" | "no";
  minSharesOut?: number;
}) {
  const { connection, wallet, market, userLocation, amount, side } = params;
  const minSharesOut = params.minSharesOut ?? 0;
  const program = getProgram(connection, wallet);
  const marketAccount = await (program.account as any).market.fetch(market);

  // Derive user position PDA
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user-position"),
      market.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    HYPERLOCAL_PROGRAM_ID
  );

  // Trader USDC ATA (assumes the user has USDC here)
  const traderUsdc = await anchor.utils.token.associatedAddress({
    mint: USDC_MINT,
    owner: wallet.publicKey,
  });

  const vault = new PublicKey(marketAccount.vault);

  const sideEnum = side === "yes" ? { yes: {} } : { no: {} };

  return await program.methods
    .placeOrder(new anchor.BN(amount), sideEnum, new anchor.BN(minSharesOut))
    .accounts({
      trader: wallet.publicKey,
      market,
      systemProgram: SystemProgram.programId,
      userLocation,
      userPosition: userPositionPda,
      traderUsdc,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// Helper to compute question hash (must match on-chain keccak)
export function questionHash(question: string): Uint8Array {
  const hash = keccak_256.array(question);
  return new Uint8Array(hash);
}

// Helper to compute region ID from region name (32-byte hash)
export function regionIdFromName(regionName: string): number[] {
  const hash = keccak_256.array(regionName);
  return Array.from(new Uint8Array(hash));
}

export interface CreateMarketParams {
  connection: Connection;
  wallet: AnchorWallet;
  regionId: number[]; // 32-byte region identifier
  question: string;
  closeTime: number; // Unix timestamp in seconds
  manifestUrl: string; // URL to resolution manifest
  manifestHash: number[]; // 32-byte hash of manifest content
  resolverPubkey?: PublicKey; // Optional custom resolver, defaults to wallet
}

export async function createMarket(params: CreateMarketParams): Promise<{
  marketPubkey: PublicKey;
  vaultPubkey: PublicKey;
  txSignature: string;
}> {
  const { connection, wallet, regionId, question, closeTime, manifestUrl, manifestHash } = params;
  const resolver = params.resolverPubkey ?? wallet.publicKey;
  
  const program = getProgram(connection, wallet);
  
  // Compute question hash for PDA derivation
  const qHash = questionHash(question);
  
  // Derive market PDA
  const [marketPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      wallet.publicKey.toBuffer(),
      Buffer.from(qHash),
    ],
    HYPERLOCAL_PROGRAM_ID
  );
  
  // Derive vault ATA (associated token account for market PDA)
  const vaultAta = await anchor.utils.token.associatedAddress({
    mint: USDC_MINT,
    owner: marketPda,
  });
  
  // Convert arrays to the format Anchor expects
  const regionIdArray = Array.from(regionId);
  const manifestHashArray = Array.from(manifestHash);
  
  const txSignature = await program.methods
    .createMarket(
      regionIdArray,
      question,
      new anchor.BN(closeTime),
      manifestUrl,
      manifestHashArray
    )
    .accounts({
      payer: wallet.publicKey,
      market: marketPda,
      usdcMint: USDC_MINT,
      vault: vaultAta,
      resolver: resolver,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  
  return {
    marketPubkey: marketPda,
    vaultPubkey: vaultAta,
    txSignature,
  };
}

// Helper to create a simple manifest hash from content
export function hashManifest(content: string): number[] {
  const hash = keccak_256.array(content);
  return Array.from(new Uint8Array(hash));
}
