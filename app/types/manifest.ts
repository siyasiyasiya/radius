export type ResolutionType = "LLM_WEB_GENERIC";

export interface ResolutionManifest {
  title: string;
  description: string;
  deadline: string; // ISO-8601 String (e.g. "2025-12-25T12:00:00Z")

  resolution_type: ResolutionType;

  config: {
    // The query the agent should look up on the web
    search_query: string;
    // Natural-language rule for mapping evidence -> YES/NO
    validation_rules: string;
    // Optional comma-separated list of domains to prioritize
    required_domains?: string;
  };
}

// --- Helper Types for the Agent ---

export interface OracleResult {
  outcome: "YES" | "NO" | "UNSURE";
  confidence: number; // 0.0 to 1.0
  reason: string;
  evidenceUrl?: string;
}

// Basic guard to validate a loaded manifest shape.
export function isValidManifest(obj: any): obj is ResolutionManifest {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.title === "string" &&
    typeof obj.description === "string" &&
    typeof obj.deadline === "string" &&
    obj.resolution_type === "LLM_WEB_GENERIC" &&
    typeof obj.config === "object" &&
    obj.config !== null &&
    typeof obj.config.search_query === "string" &&
    typeof obj.config.validation_rules === "string"
  );
}
