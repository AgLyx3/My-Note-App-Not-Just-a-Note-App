export interface LabRun {
  run_id: string;
  created_at: string;
  tester_id: string;
  algorithm_version: string;
  dataset_source: "default_fixture" | "prompt_generated";
  embedding_mode: "openai_or_lexical";
  user_id: string;
}

export interface LabCandidateScore {
  rank: number;
  collection_id: string;
  collection_name: string;
  collection_note_count: number;
  score: number;
  semantic_score: number;
  fused_score: number;
}

export interface LabTrace {
  trace_id: string;
  run_id: string;
  created_at: string;
  entry_id: string;
  entry_text: string;
  source: "model" | "fallback" | "cold_start";
  latency_ms: number;
  top1_score: number | null;
  top2_score: number | null;
  margin: number | null;
  candidates: LabCandidateScore[];
}

export interface LabDecision {
  decision_id: string;
  trace_id: string;
  run_id: string;
  created_at: string;
  selected_kind: "collection" | "create_new";
  selected_collection_id: string | null;
  selected_collection_note_count: number | null;
  selected_rank: number | null;
  expected_collection_id: string | null;
  failure_reason: string | null;
}

export interface LabMetrics {
  traces: number;
  decisions: number;
  hit_at_1: number;
  hit_at_3: number;
  mrr: number;
  fallback_rate: number;
  p95_latency_ms: number;
}

export interface LabBucketDetail {
  id: string;
  name: string;
  note_count: number;
  notes: string[];
}
