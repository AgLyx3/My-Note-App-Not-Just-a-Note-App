export interface TelemetryEvent {
  timestamp: string;
  distinct_id: string;
  event: string;
  properties: Record<string, unknown>;
}

export interface TelemetrySummary {
  window_hours: number;
  total_events: number;
  captures_created: number;
  suggestions_requested: number;
  suggestions_succeeded: number;
  placement_confirmed: number;
  suggestion_success_rate: number;
  fallback_rate: number;
  p95_latency_ms: number;
  avg_confidence_score: number;
  top_kind_distribution: { collection: number; create_new: number };
}

export interface ProductionTrace {
  entry_id: string;
  distinct_id: string;
  capture_created_at: string | null;
  suggestions_requested_at: string | null;
  suggestions_succeeded_at: string | null;
  placement_confirmed_at: string | null;
  suggestion_source: "model" | "fallback" | "cold_start" | null;
  confidence_score: number | null;
  confidence_label: string | null;
  top_kind: "collection" | "create_new" | null;
  top_score: number | null;
  alternatives_count: number | null;
  latency_ms: number | null;
  selected_kind: "collection" | "create_new" | null;
  selected_collection_id: string | null;
  selected_collection_note_count: number | null;
}

