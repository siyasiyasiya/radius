export type ResolutionType = "LLM_WEB_GENERIC";

// Full manifest format (for file-based manifests)
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

// Compact manifest format (for on-chain storage to fit tx limits)
export interface CompactManifest {
  q: string;      // question
  loc: string;    // location (short)
  t: string;      // type ("LLM")
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

// Guard for compact manifest format
export function isCompactManifest(obj: any): obj is CompactManifest {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.q === "string" &&
    typeof obj.loc === "string" &&
    typeof obj.t === "string"
  );
}

// Convert compact manifest to full manifest for processing
export function expandCompactManifest(compact: CompactManifest): ResolutionManifest {
  return {
    title: compact.q,
    description: `Market for: ${compact.q} in ${compact.loc}`,
    deadline: new Date(Date.now() + 86400000).toISOString(), // Default 24h
    resolution_type: "LLM_WEB_GENERIC",
    config: {
      search_query: `${compact.q} ${compact.loc}`,
      validation_rules: `Resolve YES if credible sources confirm "${compact.q}" is true. Resolve NO otherwise.`,
    },
  };
}
