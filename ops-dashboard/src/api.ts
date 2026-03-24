import type { ProductionTrace, TelemetryEvent, TelemetrySummary } from "./types";

function withTokenHeaders(token: string) {
  const headers: Record<string, string> = {};
  if (token) headers["x-dashboard-token"] = token;
  return headers;
}

export async function fetchSummary(hours: number, token: string): Promise<TelemetrySummary> {
  const res = await fetch(`/v1/metrics/summary?hours=${encodeURIComponent(String(hours))}`, {
    headers: withTokenHeaders(token)
  });
  if (!res.ok) throw new Error(`Summary request failed (${res.status})`);
  const body = (await res.json()) as { summary: TelemetrySummary };
  return body.summary;
}

export async function fetchEvents(hours: number, limit: number, token: string): Promise<TelemetryEvent[]> {
  const res = await fetch(
    `/v1/metrics/events?hours=${encodeURIComponent(String(hours))}&limit=${encodeURIComponent(String(limit))}`,
    { headers: withTokenHeaders(token) }
  );
  if (!res.ok) throw new Error(`Events request failed (${res.status})`);
  const body = (await res.json()) as { events: TelemetryEvent[] };
  return body.events;
}

export async function fetchProductionTraces(hours: number, limit: number, token: string): Promise<ProductionTrace[]> {
  const res = await fetch(
    `/v1/metrics/production-traces?hours=${encodeURIComponent(String(hours))}&limit=${encodeURIComponent(String(limit))}`,
    { headers: withTokenHeaders(token) }
  );
  if (!res.ok) throw new Error(`Production traces request failed (${res.status})`);
  const body = (await res.json()) as { traces: ProductionTrace[] };
  return body.traces;
}

