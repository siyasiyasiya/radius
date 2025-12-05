/**
 * Off-chain resolution agent (Phase 3).
 * Run this with: npx ts-node scripts/run_agent.ts
 */
import fs from "fs";
import path from "path";
import "dotenv/config";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  ComputeBudgetProgram 
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  ResolutionManifest,
  OracleResult,
  isValidManifest,
  isCompactManifest,
  expandCompactManifest,
} from "../app/types/manifest"; // Ensure this path is correct

// Load IDL
const hyperlocalIdlPath = path.resolve(process.cwd(), "target/idl/hyperlocal_markets.json");
const hyperlocalIdl = JSON.parse(fs.readFileSync(hyperlocalIdlPath, "utf8")) as anchor.Idl;

// 1. CONFIGURATION
const PROGRAM_ID = new PublicKey(
  process.env.HYPERLOCAL_MARKETS_PROGRAM_ID ??
    "EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox" 
);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const RESOLVER_KEYPAIR_PATH =
  process.env.RESOLVER_KEYPAIR ??
  path.join(process.env.HOME || ".", ".config", "solana", "id.json");

// FIX: Use the specific 'latest' alias which is more reliable than the generic tag
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const OUTCOME_NONE = 0;
const OUTCOME_YES = 1;
const OUTCOME_NO = 2;
const STATUS_RESOLVED = 2; // Usually 2 in Rust enums (Active=1, Resolved=2, disputed=3 etc. verify your Rust state)

interface MarketAccount {
  manifestUrl: string;
  manifestHash: number[];
  status: number;
  closeTime: number | anchor.BN;
  question: string;
}

// 2. HELPER FUNCTIONS
function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function fetchManifest(market: MarketAccount): Promise<ResolutionManifest | null> {
  const url = market.manifestUrl;
  if (!url) return null;

  try {
    // First, try to parse as inline JSON (auto-generated manifests)
    if (url.startsWith("{")) {
      const parsed = JSON.parse(url);
      
      // Check for compact manifest format first
      if (isCompactManifest(parsed)) {
        console.log("  ✓ Parsed compact inline manifest, expanding...");
        return expandCompactManifest(parsed);
      }
      
      if (isValidManifest(parsed)) {
        console.log("  ✓ Parsed inline manifest JSON");
        return parsed;
      }
    }

    // Then try as HTTP URL
    if (url.startsWith("http")) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = await response.json();
      if (isValidManifest(data)) return data;
    } else {
      // Try as file path
      let filePath = url;
      // Resolve relative paths if needed
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve(process.cwd(), url);
      }
      
      // Fallback to manifest directory hash check
      if (!fs.existsSync(filePath)) {
        const manifestDir = path.join(process.cwd(), "manifests");
        const hashedName = Buffer.from(market.manifestHash).toString("hex");
        const candidate = path.join(manifestDir, `${hashedName}.json`);
        if (fs.existsSync(candidate)) filePath = candidate;
      }

      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (isValidManifest(parsed)) return parsed;
      }
    }
  } catch (e) {
    console.warn(`Failed to load manifest from ${url}:`, e);
  }
  return null;
}

async function searchWeb(query: string, requiredDomains?: string): Promise<{ url: string; snippet: string }[]> {
  // 1. Tavily
  // 1. Tavily (Preferred & Improved)
  if (process.env.TAVILY_API_KEY) {
    try {
      const body: any = {
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "advanced", // <--- CRITICAL FIX: Scrapes deeper
        max_results: 10,          // <--- CRITICAL FIX: Casts a wider net
        include_answer: true,
      };
      
      if (requiredDomains) {
        body.include_domains = requiredDomains.split(",").map((d) => d.trim());
      }
      
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      const data: any = await resp.json();
      
      if (Array.isArray(data.results)) {
        return data.results
          .map((r: any) => ({
            url: r.url ?? "",
            // Use 'content' (long) if available, fallback to 'snippet'
            snippet: r.content && r.content.length > 50 ? r.content : (r.snippet ?? ""), 
          }))
          .filter((r: any) => r.url && r.snippet);
      }
    } catch (e) {
      console.warn("Tavily search failed", e);
    }
  }
  // 2. SerpAPI
  else if (process.env.SERPAPI_KEY) {
    try {
      const params = new URLSearchParams({ engine: "google", q: query, api_key: process.env.SERPAPI_KEY, num: "5" });
      const resp = await fetch(`https://serpapi.com/search?${params.toString()}`);
      const data: any = await resp.json();
      if (Array.isArray(data.organic_results)) {
        return data.organic_results.map((r: any) => ({ url: r.link, snippet: r.snippet })).filter((r: any) => r.url);
      }
    } catch (e) { console.warn("SerpAPI search failed", e); }
  }
  return [];
}

async function callGemini(prompt: string): Promise<any> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  // Log the URL being hit (hiding the key) to debug future 404s
  console.log(`📡 Calling Gemini: ${GEMINI_API_URL.split('?')[0]}`);

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
      },
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini API Error (${response.status}): ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${raw}`);
  }
}

// 3. CORE LOGIC
// Replace your existing resolveMarketLogic function with this:
export async function resolveMarketLogic(manifest: ResolutionManifest): Promise<OracleResult> {
  // Use search logic
  const results = await searchWeb(
    manifest.config.search_query,
    manifest.config.required_domains
  );
  
  // Create evidence block
  const evidenceText = results.length > 0 
    ? results.map((r, i) => `[Result ${i+1}] Source: ${r.url}\nContent: ${r.snippet}`).join("\n\n")
    : "No search results found.";

  if (!GEMINI_API_KEY) return { outcome: "UNSURE", confidence: 0, reason: "Missing GEMINI_API_KEY" };
  if (results.length === 0) return { outcome: "UNSURE", confidence: 0, reason: "No search results found" };

  try {
    // UPDATED PROMPT: More aggressive instructions on filtering
    const prompt = `You are an impartial oracle. Your job is to determine the outcome of a prediction market based ONLY on the evidence provided.

    CONTEXT:
    Question: "${manifest.title}"
    Rules: ${JSON.stringify(manifest.config.validation_rules)}

    CRITICAL INSTRUCTIONS:
    1. FILTERING: Search results often contain "noise" (e.g., if the question is about Football, ignore results about Basketball or Baseball).
    2. DATES: Ensure the evidence matches the specific year/date in the Question.
    3. SPECIFICITY: If 9 results discuss unrelated topics and 1 result contains the exact answer, rely on that 1 result.

    EVIDENCE:
    ${evidenceText}

    RESPONSE FORMAT:
    Return valid JSON only: { "outcome": "YES"|"NO"|"UNSURE", "confidence": number (0.0-1.0), "reason": "concise explanation citing the specific source URL used" }`;

    const geminiResponse = await callGemini(prompt);
    
    // Parse response (same as before)
    const rawText = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let cleanedText = rawText.trim().replace(/^```json\s*|\s*```$/g, "").replace(/^```\s*|\s*```$/g, "");
    
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
       // Fallback: sometimes Gemini adds text before/after JSON
       const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
       if (jsonMatch) {
         parsed = JSON.parse(jsonMatch[0]);
       } else {
         return { outcome: "UNSURE", confidence: 0, reason: "JSON Parse Failed" };
       }
    }

    const outcome = ["YES", "NO", "UNSURE"].includes(parsed.outcome) ? parsed.outcome : "UNSURE";
    
    // LOGIC TO FIND WHICH URL WAS USED
    // If the AI cites a specific source in the 'reason', try to find that URL. 
    // Otherwise default to the first one, but this is less accurate.
    let evidenceUrl = results[0]?.url || "";
    if (parsed.reason) {
      const match = results.find(r => parsed.reason.includes(r.url) || r.snippet.includes(parsed.reason.substring(0, 20)));
      if (match) evidenceUrl = match.url;
    }

    return {
      outcome: outcome as OracleResult["outcome"],
      confidence: parsed.confidence || 0,
      reason: parsed.reason || "AI Logic",
      evidenceUrl: evidenceUrl,
    };
  } catch (e) {
    console.error("Gemini Logic Error:", e);
    return { outcome: "UNSURE", confidence: 0, reason: "Gemini API call failed" };
  }
}

// Polling interval in milliseconds (default: 30 seconds)
const POLL_INTERVAL_MS = parseInt(process.env.AGENT_POLL_INTERVAL || "30000");

// 4. MAIN LOOP
async function runOnce(program: anchor.Program, resolverKp: Keypair): Promise<number> {
  // Fetch all markets
  const markets = await (program.account["market"] as any).all() as { publicKey: PublicKey; account: MarketAccount }[];
  
  const nowTs = Math.floor(Date.now() / 1000);
  const candidates = markets.filter((m) => {
    const status = m.account.status as number;
    const closeTime = typeof m.account.closeTime === 'number' 
      ? m.account.closeTime 
      : m.account.closeTime.toNumber();
      
    // Must be NOT resolved AND time must be in the past
    return status !== STATUS_RESOLVED && closeTime < nowTs;
  });

  if (candidates.length === 0) {
    return 0;
  }

  console.log(`\n📊 Found ${candidates.length} markets pending resolution.`);
  let resolved = 0;

  for (const { publicKey, account } of candidates) {
    console.log(`\n🔍 Processing: ${publicKey.toBase58().slice(0, 8)}... | "${account.question}"`);
    
    const manifest = await fetchManifest(account);
    if (!manifest) {
      console.warn(`  ⚠️ Skipping - Manifest unreadable.`);
      continue;
    }

    const result = await resolveMarketLogic(manifest);
    console.log(`  🤖 Verdict: ${result.outcome} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
    console.log(`  📝 Reason: ${result.reason}`);

    if (result.outcome === "UNSURE") {
      console.log(`  ⏭️ Skipping - outcome uncertain`);
      continue;
    }

    const outcomeU8 = result.outcome === "YES" ? OUTCOME_YES : OUTCOME_NO;
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });

    try {
      const tx = await program.methods
        .agentAttemptResolution(outcomeU8, result.evidenceUrl || "", result.reason)
        .accounts({ market: publicKey, resolver: resolverKp.publicKey })
        .preInstructions([modifyComputeUnits, addPriorityFee])
        .signers([resolverKp])
        .rpc();

      console.log(`  ✅ Resolved! Tx: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      resolved++;
    } catch (e) {
      console.error(`  ❌ Transaction failed:`, e);
    }
  }

  return resolved;
}

async function main() {
  const resolverKp = loadKeypair(RESOLVER_KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(resolverKp);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  
  const program = new anchor.Program(hyperlocalIdl, provider);

  // Check if running in continuous mode
  const continuous = process.argv.includes("--watch") || process.argv.includes("-w");

  if (continuous) {
    console.log("🤖 Oracle Agent running in WATCH mode");
    console.log(`   Polling every ${POLL_INTERVAL_MS / 1000}s for markets to resolve...`);
    console.log(`   Press Ctrl+C to stop\n`);

    // Run continuously
    while (true) {
      const timestamp = new Date().toLocaleTimeString();
      process.stdout.write(`[${timestamp}] Checking for resolvable markets... `);
      
      try {
        const resolved = await runOnce(program, resolverKp);
        if (resolved > 0) {
          console.log(`✅ Resolved ${resolved} market(s)`);
        } else {
          console.log(`No markets ready`);
        }
      } catch (e) {
        console.log(`⚠️ Error: ${(e as Error).message}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } else {
    // Single run mode
    console.log("🤖 Oracle Agent - Single Run Mode");
    console.log("   (Use --watch or -w for continuous mode)\n");
    
    const resolved = await runOnce(program, resolverKp);
    
    if (resolved === 0) {
      console.log("\n💡 No markets resolved. Tips:");
      console.log("   - Create a market with a close time in the past");
      console.log("   - Or run with --watch to wait for markets to expire");
    }
    
    console.log("\n✨ Done.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});