import type { LabBucketDetail, LabDecision, LabMetrics, LabRun, LabTrace } from "./types";

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function createRun(input: {
  tester_id?: string;
  algorithm_version?: string;
  dataset_source?: "default_fixture" | "prompt_generated";
}) {
  return json<{ run: LabRun }>("/v1/lab/runs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function loadDefaultDataset(runId: string) {
  return json<{ collections_created: number; cases_created: number; cases: Array<{ capture_text: string; expected_collection_name: string }> }>(
    `/v1/lab/runs/${runId}/datasets/default`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export async function generateDataset(
  runId: string,
  input: { prompt: string; bucket_count?: number; notes_per_bucket?: number }
) {
  return json<{
    collections_created: number;
    cases_created: number;
    generation_source?: "llm" | "fallback";
    cases: Array<{ capture_text: string; expected_collection_name: string }>;
  }>(
    `/v1/lab/runs/${runId}/datasets/generate`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function runCaptureTest(runId: string, capture_text: string) {
  return json<{ trace: LabTrace }>(`/v1/lab/runs/${runId}/capture-test`, {
    method: "POST",
    body: JSON.stringify({ capture_text })
  });
}

export async function submitDecision(
  runId: string,
  input: {
    trace_id: string;
    selected_kind: "collection" | "create_new";
    selected_collection_id: string | null;
    selected_collection_note_count?: number | null;
    selected_rank: number | null;
    expected_collection_id?: string | null;
    failure_reason?: string | null;
  }
) {
  return json<{ decision: LabDecision }>(`/v1/lab/runs/${runId}/decisions`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchMetrics(runId: string) {
  return json<{ run: LabRun; metrics: LabMetrics }>(`/v1/lab/runs/${runId}/metrics`);
}

export async function fetchTraces(runId: string) {
  return json<{
    run: LabRun;
    traces: LabTrace[];
    decisions: LabDecision[];
    cases: Array<{ capture_text: string; expected_collection_name: string }>;
  }>(`/v1/lab/runs/${runId}/traces`);
}

export async function fetchState(runId: string) {
  return json<{
    run: LabRun;
    buckets: LabBucketDetail[];
    cases: Array<{ capture_text: string; expected_collection_name: string }>;
  }>(`/v1/lab/runs/${runId}/state`);
}

export async function addBucket(runId: string, name: string) {
  return json<{ bucket: { id: string; name: string } }>(`/v1/lab/runs/${runId}/buckets`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export async function addNote(runId: string, input: { collection_id: string; text: string }) {
  return json<{ note: { entry_id: string; collection_id: string } }>(`/v1/lab/runs/${runId}/notes`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function generateNotes(
  runId: string,
  input: { collection_id?: string; collection_ids?: string[]; prompt?: string; count?: number }
) {
  return json<{ inserted: number; buckets_touched?: number }>(`/v1/lab/runs/${runId}/notes/generate`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
