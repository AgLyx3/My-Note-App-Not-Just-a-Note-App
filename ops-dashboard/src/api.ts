import type { ProductionTrace, TelemetryEvent, TelemetrySummary } from "./types";

function withTokenHeaders(token: string) {
  const headers: Record<string, string> = {};
  if (token) headers["x-dashboard-token"] = token;
  return headers;
}

function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path}`;
}

async function checkedFetch(url: string, token: string): Promise<Response> {
  const res = await fetch(url, { headers: withTokenHeaders(token) });
  if (res.ok) return res;
  let details = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) details = `: ${body.error.message}`;
  } catch {
    // ignore parsing errors
  }
  throw new Error(`Request failed (${res.status})${details}`);
}

export async function fetchSummary(hours: number, token: string, baseUrl: string): Promise<TelemetrySummary> {
  const res = await checkedFetch(buildUrl(baseUrl, `/v1/metrics/summary?hours=${encodeURIComponent(String(hours))}`), token);
  const body = (await res.json()) as { summary: TelemetrySummary };
  return body.summary;
}

export async function fetchEvents(hours: number, limit: number, token: string, baseUrl: string): Promise<TelemetryEvent[]> {
  const res = await checkedFetch(
    buildUrl(
      baseUrl,
      `/v1/metrics/events?hours=${encodeURIComponent(String(hours))}&limit=${encodeURIComponent(String(limit))}`
    ),
    token
  );
  const body = (await res.json()) as { events: TelemetryEvent[] };
  return body.events;
}

export async function fetchProductionTraces(
  hours: number,
  limit: number,
  token: string,
  baseUrl: string
): Promise<ProductionTrace[]> {
  const res = await checkedFetch(
    buildUrl(
      baseUrl,
      `/v1/metrics/production-traces?hours=${encodeURIComponent(String(hours))}&limit=${encodeURIComponent(String(limit))}`
    ),
    token
  );
  const body = (await res.json()) as { traces: ProductionTrace[] };
  return body.traces;
}

