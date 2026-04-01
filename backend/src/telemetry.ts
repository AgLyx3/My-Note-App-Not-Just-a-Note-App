import { getPool } from "./db/client.js";
import { telemetryEvents } from "./db/schema.js";

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
  existing_bucket_rate: number;
  create_new_rate: number;
  accept_at_3: number;
  mrr_selected: number;
}

export interface TelemetryTimeseriesPoint {
  bucket_start: string;
  suggestions_requested: number;
  suggestions_succeeded: number;
  fallbacks: number;
  placement_confirmed: number;
  avg_latency_ms: number;
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
  suggested_collection_ids: string[] | null;
  selected_suggested_rank: number | null;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export class TelemetryStore {
  private initialized = false;

  constructor() {
    // No work here; initialize lazily so telemetry never blocks startup.
  }

  private async ensureReady() {
    if (this.initialized) return;
    this.initialized = true;
    const pool = getPool();
    if (!pool) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL,
          distinct_id TEXT NOT NULL,
          event TEXT NOT NULL,
          properties JSONB NOT NULL
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS telemetry_events_ts_idx ON telemetry_events (timestamp);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS telemetry_events_event_ts_idx ON telemetry_events (event, timestamp);`);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS telemetry_events_entry_id_idx ON telemetry_events ((properties->>'entry_id')) WHERE properties ? 'entry_id';`
      );
    } catch {
      // Non-fatal; telemetry should not affect product behavior.
    }
  }

  record(event: TelemetryEvent) {
    try {
      // Fire-and-forget.
      void this.recordAsync(event);
    } catch {
      // Non-fatal; telemetry should not affect product behavior.
    }
  }

  private async recordAsync(event: TelemetryEvent) {
    await this.ensureReady();
    const pool = getPool();
    if (!pool) return;
    try {
      const db = (await import("./db/client.js")).getDb?.() ?? null;
      // Avoid circular import issues by using pool directly when db isn't available.
      if (!db) {
        await pool.query(
          `INSERT INTO telemetry_events (timestamp, distinct_id, event, properties) VALUES ($1, $2, $3, $4::jsonb)`,
          [event.timestamp, event.distinct_id, event.event, JSON.stringify(event.properties ?? {})]
        );
        return;
      }
      await db.insert(telemetryEvents).values({
        timestamp: new Date(event.timestamp),
        distinctId: event.distinct_id,
        event: event.event,
        properties: (event.properties ?? {}) as Record<string, unknown>
      });
    } catch {
      // Non-fatal.
    }
  }

  async listRecentEvents(windowHours = 24, maxEvents = 1000): Promise<TelemetryEvent[]> {
    await this.ensureReady();
    const pool = getPool();
    if (!pool) return [];
    const now = Date.now();
    const fromIso = new Date(now - windowHours * 60 * 60 * 1000).toISOString();
    try {
      // Fetch newest first then reverse to match previous ascending behavior.
      const res = await pool.query(
        `SELECT timestamp, distinct_id, event, properties
         FROM telemetry_events
         WHERE timestamp >= $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [fromIso, Math.max(1, maxEvents)]
      );
      const rows = res.rows
        .map((r) => ({
          timestamp: new Date(r.timestamp).toISOString(),
          distinct_id: String(r.distinct_id ?? ""),
          event: String(r.event ?? ""),
          properties: (r.properties ?? {}) as Record<string, unknown>
        }))
        .filter((e) => e.timestamp && e.distinct_id && e.event);
      rows.reverse();
      return rows;
    } catch {
      return [];
    }
  }

  async getSummary(windowHours = 24): Promise<TelemetrySummary> {
    const events = await this.listRecentEvents(windowHours, 50_000);
    const captures = events.filter((e) => e.event === "capture_created");
    const requested = events.filter((e) => e.event === "suggestions_requested");
    const succeeded = events.filter((e) => e.event === "suggestions_succeeded");
    const confirmed = events.filter((e) => e.event === "placement_confirmed");
    const fallback = succeeded.filter((e) => String(e.properties.source ?? "") === "fallback");
    const latencies = succeeded
      .map((e) => Number(e.properties.latency_ms))
      .filter((x) => Number.isFinite(x) && x >= 0);
    const confidence = succeeded
      .map((e) => Number(e.properties.confidence_score))
      .filter((x) => Number.isFinite(x));
    const topCollection = succeeded.filter((e) => String(e.properties.top_kind ?? "") === "collection").length;
    const topCreateNew = succeeded.filter((e) => String(e.properties.top_kind ?? "") === "create_new").length;
    const selectedExisting = confirmed.filter((e) => String(e.properties.selected_kind ?? "") === "collection").length;
    const selectedCreateNew = confirmed.filter((e) => String(e.properties.selected_kind ?? "") === "create_new").length;

    const traces = await this.getProductionTraces(windowHours, 50_000);
    const judged = traces.filter((t) => t.selected_kind === "collection" && typeof t.selected_suggested_rank === "number");
    const acceptAt3 = judged.length ? judged.filter((t) => (t.selected_suggested_rank ?? 999) <= 3).length / judged.length : 0;
    const mrr =
      judged.length
        ? judged.reduce((s, t) => s + (t.selected_suggested_rank ? 1 / t.selected_suggested_rank : 0), 0) / judged.length
        : 0;

    return {
      window_hours: windowHours,
      total_events: events.length,
      captures_created: captures.length,
      suggestions_requested: requested.length,
      suggestions_succeeded: succeeded.length,
      placement_confirmed: confirmed.length,
      suggestion_success_rate: requested.length > 0 ? succeeded.length / requested.length : 0,
      fallback_rate: succeeded.length > 0 ? fallback.length / succeeded.length : 0,
      p95_latency_ms: percentile(latencies, 95),
      avg_confidence_score:
        confidence.length > 0 ? confidence.reduce((s, x) => s + x, 0) / confidence.length : 0,
      top_kind_distribution: {
        collection: topCollection,
        create_new: topCreateNew
      },
      existing_bucket_rate: confirmed.length ? selectedExisting / confirmed.length : 0,
      create_new_rate: confirmed.length ? selectedCreateNew / confirmed.length : 0,
      accept_at_3: acceptAt3,
      mrr_selected: mrr
    };
  }

  async getTimeseries(windowHours = 24, bucketMinutes = 60): Promise<TelemetryTimeseriesPoint[]> {
    const safeBucketMinutes = Math.max(1, Math.min(24 * 60, Math.floor(bucketMinutes)));
    const events = await this.listRecentEvents(windowHours, 100_000);
    const now = Date.now();
    const startMs = now - windowHours * 60 * 60 * 1000;
    const bucketMs = safeBucketMinutes * 60 * 1000;
    const bucketCount = Math.max(1, Math.ceil((now - startMs) / bucketMs));

    const buckets: TelemetryTimeseriesPoint[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = startMs + i * bucketMs;
      buckets.push({
        bucket_start: new Date(bucketStart).toISOString(),
        suggestions_requested: 0,
        suggestions_succeeded: 0,
        fallbacks: 0,
        placement_confirmed: 0,
        avg_latency_ms: 0
      });
    }

    const latencySums = new Array<number>(bucketCount).fill(0);
    const latencyCounts = new Array<number>(bucketCount).fill(0);

    for (const event of events) {
      const ts = new Date(event.timestamp).getTime();
      if (!Number.isFinite(ts) || ts < startMs || ts > now) continue;
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - startMs) / bucketMs)));
      const bucket = buckets[idx];
      if (!bucket) continue;

      if (event.event === "suggestions_requested") {
        bucket.suggestions_requested += 1;
      } else if (event.event === "suggestions_succeeded") {
        bucket.suggestions_succeeded += 1;
        if (String(event.properties.source ?? "") === "fallback") {
          bucket.fallbacks += 1;
        }
        const latency = Number(event.properties.latency_ms);
        if (Number.isFinite(latency) && latency >= 0) {
          latencySums[idx] += latency;
          latencyCounts[idx] += 1;
        }
      } else if (event.event === "placement_confirmed") {
        bucket.placement_confirmed += 1;
      }
    }

    for (let i = 0; i < bucketCount; i++) {
      if (latencyCounts[i] > 0) {
        buckets[i]!.avg_latency_ms = latencySums[i]! / latencyCounts[i]!;
      }
    }

    return buckets;
  }

  async getProductionTraces(windowHours = 24, limit = 200): Promise<ProductionTrace[]> {
    const events = await this.listRecentEvents(windowHours, 100_000);
    const byEntry = new Map<string, ProductionTrace>();

    const ensure = (entryId: string, distinctId: string): ProductionTrace => {
      const existing = byEntry.get(entryId);
      if (existing) return existing;
      const row: ProductionTrace = {
        entry_id: entryId,
        distinct_id: distinctId,
        capture_created_at: null,
        suggestions_requested_at: null,
        suggestions_succeeded_at: null,
        placement_confirmed_at: null,
        suggestion_source: null,
        confidence_score: null,
        confidence_label: null,
        top_kind: null,
        top_score: null,
        alternatives_count: null,
        latency_ms: null,
        selected_kind: null,
        selected_collection_id: null,
        selected_collection_note_count: null,
        suggested_collection_ids: null,
        selected_suggested_rank: null
      };
      byEntry.set(entryId, row);
      return row;
    };

    for (const event of events) {
      const entryIdRaw = event.properties.entry_id;
      const entryId = typeof entryIdRaw === "string" && entryIdRaw.length > 0 ? entryIdRaw : null;
      if (!entryId) continue;
      const row = ensure(entryId, event.distinct_id);

      if (event.event === "capture_created") {
        row.capture_created_at = event.timestamp;
      } else if (event.event === "suggestions_requested") {
        row.suggestions_requested_at = event.timestamp;
      } else if (event.event === "suggestions_succeeded") {
        row.suggestions_succeeded_at = event.timestamp;
        const source = String(event.properties.source ?? "");
        if (source === "model" || source === "fallback" || source === "cold_start") {
          row.suggestion_source = source;
        }
        const confidence = Number(event.properties.confidence_score);
        row.confidence_score = Number.isFinite(confidence) ? confidence : null;
        const confLabel = event.properties.confidence_label;
        row.confidence_label = typeof confLabel === "string" ? confLabel : null;
        const topKind = String(event.properties.top_kind ?? "");
        if (topKind === "collection" || topKind === "create_new") {
          row.top_kind = topKind;
        }
        const topScore = Number(event.properties.top_score);
        row.top_score = Number.isFinite(topScore) ? topScore : null;
        const alternatives = Number(event.properties.alternatives_count);
        row.alternatives_count = Number.isFinite(alternatives) ? alternatives : null;
        const latency = Number(event.properties.latency_ms);
        row.latency_ms = Number.isFinite(latency) ? latency : null;
        const suggestedIdsRaw = event.properties.suggested_collection_ids;
        if (Array.isArray(suggestedIdsRaw) && suggestedIdsRaw.every((x) => typeof x === "string")) {
          row.suggested_collection_ids = suggestedIdsRaw;
        }
      } else if (event.event === "placement_confirmed") {
        row.placement_confirmed_at = event.timestamp;
        const selectedKind = String(event.properties.selected_kind ?? "");
        if (selectedKind === "collection" || selectedKind === "create_new") {
          row.selected_kind = selectedKind;
        }
        const selectedCollectionId = event.properties.selected_collection_id;
        row.selected_collection_id = typeof selectedCollectionId === "string" ? selectedCollectionId : null;
        const selectedCollectionNoteCount = Number(event.properties.selected_collection_note_count);
        row.selected_collection_note_count = Number.isFinite(selectedCollectionNoteCount)
          ? selectedCollectionNoteCount
          : null;
      }
    }

    for (const t of byEntry.values()) {
      if (t.selected_kind === "collection" && t.selected_collection_id && Array.isArray(t.suggested_collection_ids)) {
        const idx = t.suggested_collection_ids.indexOf(t.selected_collection_id);
        t.selected_suggested_rank = idx >= 0 ? idx + 1 : null;
      }
    }

    return [...byEntry.values()]
      .sort((a, b) => {
        const aTs = a.suggestions_succeeded_at ?? a.suggestions_requested_at ?? a.capture_created_at ?? "";
        const bTs = b.suggestions_succeeded_at ?? b.suggestions_requested_at ?? b.capture_created_at ?? "";
        return bTs.localeCompare(aTs);
      })
      .slice(0, Math.max(1, limit));
  }
}

