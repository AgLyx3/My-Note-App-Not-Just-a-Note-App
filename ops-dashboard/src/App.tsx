import { useEffect, useMemo, useState } from "react";
import { fetchEvents, fetchProductionTraces, fetchSummary } from "./api";
import type { ProductionTrace, TelemetryEvent, TelemetrySummary } from "./types";

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_LIMIT = 100;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtMs(value: number): string {
  return `${Math.round(value)} ms`;
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function App() {
  const [hours, setHours] = useState<number>(DEFAULT_WINDOW_HOURS);
  const [token, setToken] = useState<string>("");
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("ops.apiBaseUrl") ?? "";
  });
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [productionTraces, setProductionTraces] = useState<ProductionTrace[]>([]);
  const [status, setStatus] = useState<string>("Loading...");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const [s, e, traces] = await Promise.all([
        fetchSummary(hours, token, apiBaseUrl),
        fetchEvents(hours, DEFAULT_LIMIT, token, apiBaseUrl),
        fetchProductionTraces(hours, DEFAULT_LIMIT, token, apiBaseUrl)
      ]);
      setSummary(s);
      setEvents(e);
      setProductionTraces(traces);
      setStatus(`Updated at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ops.apiBaseUrl", apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 10000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, hours, token, apiBaseUrl]);

  const lastEvents = useMemo(() => [...events].reverse(), [events]);

  return (
    <main className="page">
      <header className="header">
        <h1>Notes App Ops Dashboard</h1>
        <p>Production telemetry for capture - suggestion - confirmation flow.</p>
      </header>

      <section className="controls">
        <label>
          Window (hours)
          <input
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || DEFAULT_WINDOW_HOURS)}
          />
        </label>
        <label>
          Dashboard token (optional)
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="matches backend DASHBOARD_TOKEN"
          />
        </label>
        <label>
          Backend URL (Render/local)
          <input
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="https://your-backend.onrender.com"
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto refresh (10s)
        </label>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh now"}
        </button>
      </section>

      <p className="status">{status}</p>

      {summary ? (
        <>
          <section className="grid">
            <article className="card">
              <h3>Captures</h3>
              <p>{summary.captures_created}</p>
            </article>
            <article className="card">
              <h3>Suggestions Requested</h3>
              <p>{summary.suggestions_requested}</p>
            </article>
            <article className="card">
              <h3>Suggestions Succeeded</h3>
              <p>{summary.suggestions_succeeded}</p>
            </article>
            <article className="card">
              <h3>Placements Confirmed</h3>
              <p>{summary.placement_confirmed}</p>
            </article>
            <article className="card">
              <h3>Suggestion Success Rate</h3>
              <p>{pct(summary.suggestion_success_rate)}</p>
            </article>
            <article className="card">
              <h3>Fallback Rate</h3>
              <p>{pct(summary.fallback_rate)}</p>
            </article>
            <article className="card">
              <h3>P95 Latency</h3>
              <p>{fmtMs(summary.p95_latency_ms)}</p>
            </article>
            <article className="card">
              <h3>Avg Confidence</h3>
              <p>{summary.avg_confidence_score.toFixed(3)}</p>
            </article>
          </section>

          <section className="split">
            <article className="card">
              <h3>Top Kind Distribution</h3>
              <div className="kv">
                <span>Collection</span>
                <strong>{summary.top_kind_distribution.collection}</strong>
              </div>
              <div className="kv">
                <span>Create New</span>
                <strong>{summary.top_kind_distribution.create_new}</strong>
              </div>
            </article>

            <article className="card">
              <h3>Production Traces</h3>
              <div className="events">
                {productionTraces.length === 0 ? (
                  <p className="muted">No production traces in this window.</p>
                ) : (
                  productionTraces.map((t) => (
                    <div key={t.entry_id} className="event">
                      <div className="event-top">
                        <strong>{t.entry_id}</strong>
                        <span>{t.suggestions_succeeded_at ? fmtTs(t.suggestions_succeeded_at) : "no suggestion yet"}</span>
                      </div>
                      <div className="trace-block">
                        <div>
                          <strong>Flow:</strong>{" "}
                          capture {t.capture_created_at ? "yes" : "no"} {"->"} requested{" "}
                          {t.suggestions_requested_at ? "yes" : "no"} {"->"} suggested{" "}
                          {t.suggestions_succeeded_at ? "yes" : "no"} {"->"} confirmed{" "}
                          {t.placement_confirmed_at ? "yes" : "no"}
                        </div>
                        <div>
                          <strong>Suggestion:</strong> {t.suggestion_source ?? "n/a"} | {t.confidence_label ?? "n/a"}{" "}
                          ({t.confidence_score?.toFixed(3) ?? "n/a"}) | top {t.top_kind ?? "n/a"} score{" "}
                          {t.top_score?.toFixed(3) ?? "n/a"} | latency {t.latency_ms ? fmtMs(t.latency_ms) : "n/a"}
                        </div>
                        <div>
                          <strong>Decision:</strong>{" "}
                          {t.selected_kind
                            ? t.selected_kind === "create_new"
                              ? "create_new"
                              : `${t.selected_collection_id ?? "collection"} (${t.selected_collection_note_count ?? "n/a"} notes)`
                            : "not confirmed"}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>

          <section className="split">
            <article className="card">
              <h3>Recent Events</h3>
              <div className="events">
                {lastEvents.length === 0 ? (
                  <p className="muted">No events in this window.</p>
                ) : (
                  lastEvents.map((e, idx) => (
                    <div key={`${e.timestamp}-${e.event}-${idx}`} className="event">
                      <div className="event-top">
                        <strong>{e.event}</strong>
                        <span>{fmtTs(e.timestamp)}</span>
                      </div>
                      <code>{JSON.stringify(e.properties)}</code>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}

