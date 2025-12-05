import "dotenv/config";
import { resolveMarketLogic } from "./run_agent.ts";
import { ResolutionManifest } from "../app/types/manifest.ts";

async function main() {
  const manifest: ResolutionManifest = {
    title: "Did Purdue beat Indiana in football 2024?",
    description: "Test manifest",
    deadline: new Date().toISOString(),
    resolution_type: "LLM_WEB_GENERIC",
    config: {
      search_query: "final score Purdue vs Indiana football 2024",
      validation_rules:
        "If Purdue's score is greater than Indiana's score, outcome is YES. If less, outcome is NO.",
      required_domains: "espn.com,ncaa.com",
    },
  };

  const result = await resolveMarketLogic(manifest);
  console.log("Oracle result:", result);
}

main().catch(console.error);
