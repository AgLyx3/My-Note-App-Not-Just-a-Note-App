/** Mirrors contract §2 — enums and placement suggestion payload shapes. */

export type ConfidenceLabel = "likely" | "possible" | "uncertain";

export type SuggestionSource = "model" | "fallback" | "cold_start";

export interface CollectionSummary {
  id: string;
  name: string;
  last_activity_at: string;
}

export interface SuggestionOption {
  kind: "collection" | "create_new";
  rank?: number;
  score?: number;
  collection?: CollectionSummary;
  /** Present when kind is create_new */
  suggested_name?: string;
}

export interface PlacementSuggestionsResponse {
  entry_id: string;
  source: SuggestionSource;
  confidence: {
    score: number;
    label: ConfidenceLabel;
    policy_version?: string;
  };
  top_option: SuggestionOption;
  alternatives: SuggestionOption[];
  reason_short?: string;
  generated_at?: string;
}
