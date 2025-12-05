/**
 * Off-chain resolution agent (Phase 3).
 * Run this with: npx ts-node agent.ts
 *
 * Env vars:
 * - GEMINI_API_KEY (Required - Get free at https://makersuite.google.com/app/apikey)
 * - TAVILY_API_KEY (Recommended for search) or SERPAPI_KEY
 * - RPC_URL (e.g., https://api.devnet.solana.com)
 * - RESOLVER_KEYPAIR (Path to your id.json)
 */
import fs from "fs";
import path from "path";
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
} from "../app/types/manifest";
import hyperlocalIdl from "../target/idl/hyperlocal_markets.json";

// 1. CONFIGURATION
const PROGRAM_ID = new PublicKey(
  process.env.HYPERLOCAL_MARKETS_PROGRAM_ID ??
    "EA838rrQJPTmk4FNMRV4esgU7rFo5oRLGgW1Nws1jzox" 
);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const RESOLVER_KEYPAIR_PATH =
  process.env.RESOLVER_KEYPAIR ??
  path.join(process.env.HOME || ".", ".config", "solana", "id.json");

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

// Outcome constants (Must match your Rust program)
const OUTCOME_NONE = 0;
const OUTCOME_YES = 1;
const OUTCOME_NO = 2;
const STATUS_RESOLVED = 2; 

type MarketAccount = anchor.IdlAccounts<typeof hyperlocalIdl>["market"];

// 2. HELPER FUNCTIONS
function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// Support fetching manifests from HTTP/IPFS gateways or local files
async function fetchManifest(market: MarketAccount): Promise<ResolutionManifest | null> {
  const url = market.manifestUrl;
  if (!url) return null;

  try {
    // If it looks like a URL, fetch it
    if (url.startsWith("http") || url.startsWith("https")) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = await response.json();
      if (isValidManifest(data)) return data;
    } 
    // Fallback: Local file system (for testing)
    else {
      let filePath = url;
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

// Web search with Tavily (preferred) or SerpAPI fallback
async function searchWeb(
  query: string,
  requiredDomains?: string
): Promise<{ url: string; snippet: string }[]> {
  // Prefer Tavily
  if (process.env.TAVILY_API_KEY) {
    try {
      const body: any = {
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
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
            snippet: r.content ?? r.snippet ?? "",
          }))
          .filter((r: any) => r.url);
      }
    } catch (e) {
      console.warn("Tavily search failed", e);
    }
  } else if (process.env.SERPAPI_KEY) {
    try {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        api_key: process.env.SERPAPI_KEY,
        num: "5",
      });
      const resp = await fetch(`https://serpapi.com/search?${params.toString()}`);
      const data: any = await resp.json();
      if (Array.isArray(data.organic_results)) {
        return data.organic_results
          .map((r: any) => ({
            url: r.link ?? "",
            snippet: r.snippet ?? "",
          }))
          .filter((r: any) => r.url);
      }
    } catch (e) {
      console.warn("SerpAPI search failed", e);
    }
  } else {
    console.warn("No TAVILY_API_KEY or SERPAPI_KEY set, cannot resolve market");
  }

  return [];
}

// Call Gemini API
async function callGemini(prompt: string): Promise<any> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0,
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// 3. CORE LOGIC
async function resolveMarketLogic(manifest: ResolutionManifest): Promise<OracleResult> {
  // Use search logic
  const results = await searchWeb(
    manifest.config.search_query,
    manifest.config.required_domains
  );
  
  // Create evidence block with clear separators
  const evidenceText = results.length > 0 
    ? results.map((r) => `Source: ${r.url}\nContent: ${r.snippet}`).join("\n---\n")
    : "No search results found.";

  if (!GEMINI_API_KEY) {
    return { outcome: "UNSURE", confidence: 0, reason: "Missing GEMINI_API_KEY" };
  }

  if (results.length === 0) {
    return { outcome: "UNSURE", confidence: 0, reason: "No search results found" };
  }

  try {
    const prompt = `You are an impartial oracle for a prediction market. You must determine the truth using ONLY the evidence text provided. Do NOT use external knowledge. Do NOT guess. Apply the given validation rules strictly.

Question: ${manifest.title}
Search Query: ${manifest.config.search_query}
Validation Rules: ${JSON.stringify(manifest.config.validation_rules)}

Evidence:
${evidenceText}

Return ONLY a valid JSON object with this exact format (no markdown, no extra text):
{
  "outcome": "YES" or "NO" or "UNSURE",
  "confidence": number between 0 and 1,
  "reason": "brief explanation"
}`;

    const geminiResponse = await callGemini(prompt);
    
    // Extract text from Gemini response
    const rawText = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    
    // Clean up any markdown code blocks
    let cleanedText = rawText.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/```\n?/g, "");
    }
    
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      return {
        outcome: "UNSURE",
        confidence: 0,
        reason: "Failed to parse Gemini JSON response",
      };
    }

    const outcome = parsed.outcome as OracleResult["outcome"];
    const confidence =
      typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reason =
      typeof parsed.reason === "string" ? parsed.reason : "No reason provided";

    const normalizedOutcome =
      outcome === "YES" || outcome === "NO" || outcome === "UNSURE"
        ? outcome
        : "UNSURE";

    const topSourceUrl = results[0]?.url ?? "";
    return {
      outcome: normalizedOutcome,
      confidence: confidence,
      reason,
      evidenceUrl: topSourceUrl,
    };
  } catch (e) {
    console.error("Gemini AI Error:", e);
    return { outcome: "UNSURE", confidence: 0, reason: "Gemini API call failed" };
  }
}

// 4. MAIN LOOP
async function main() {
  const resolverKp = loadKeypair(RESOLVER_KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(resolverKp);
  const provider = new anchor.AnchorProvider(connection, wallet, { 
    commitment: "confirmed" 
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(
    hyperlocalIdl as anchor.Idl, 
    PROGRAM_ID, 
    provider
  );

  console.log("🤖 Agent running with Gemini AI. Polling markets...");

  // Fetch all markets
  const markets = await program.account.market.all<MarketAccount>();
  
  const nowTs = Math.floor(Date.now() / 1000);
  const candidates = markets.filter((m) => {
    const status = m.account.status as number;
    // Handle closeTime as both number and BN
    const closeTime = typeof m.account.closeTime === 'number' 
      ? m.account.closeTime 
      : m.account.closeTime.toNumber();
    // Check if market is NOT resolved AND time has expired
    return status !== STATUS_RESOLVED && closeTime < nowTs;
  });

  console.log(`Found ${candidates.length} markets pending resolution.`);

  for (const { publicKey, account } of candidates) {
    console.log(`\nProcessing market: ${publicKey.toBase58()}`);
    console.log(`Question: ${account.question}`);
    
    const manifest = await fetchManifest(account);
    if (!manifest) {
      console.warn(`⚠️  Skipping - Manifest unreadable.`);
      continue;
    }

    const result = await resolveMarketLogic(manifest);
    console.log(`🤖 Gemini Verdict: ${result.outcome} (confidence: ${result.confidence})`);
    console.log(`📝 Reason: ${result.reason}`);

    // Skip if uncertain
    if (result.outcome === "UNSURE") {
      console.log(`⏭️  Skipping - Outcome is UNSURE`);
      continue;
    }

    let outcomeU8 = result.outcome === "YES" ? OUTCOME_YES : OUTCOME_NO;

    // Add Compute Budget to prevent drops on congested networks
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 200_000 
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
      microLamports: 100_000 // Adjust based on network demand
    });

    try {
      const tx = await program.methods
        .agentAttemptResolution(
          outcomeU8, 
          result.evidenceUrl || "", 
          result.reason
        )
        .accounts({
          market: publicKey,
          resolver: resolverKp.publicKey,
        })
        .preInstructions([modifyComputeUnits, addPriorityFee])
        .signers([resolverKp])
        .rpc();

      console.log(`✅ Success! Tx: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    } catch (e) {
      console.error(`❌ Failed transaction:`, e);
    }
  }

  console.log("\n✨ Agent completed processing all markets.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});