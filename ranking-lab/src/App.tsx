import { useState } from "react";
import {
  addBucket,
  addNote,
  createRun,
  fetchMetrics,
  fetchState,
  fetchTraces,
  runCaptureTest,
  submitDecision
} from "./api";
import type { LabBucketDetail, LabTrace } from "./types";

export function App() {
  const [testerId, setTesterId] = useState("local-tester");
  const [algorithmVersion, setAlgorithmVersion] = useState("dev");
  const [runId, setRunId] = useState<string>("");
  const [captureText, setCaptureText] = useState("");
  const [latestTrace, setLatestTrace] = useState<LabTrace | null>(null);
  const [status, setStatus] = useState<string>("");
  const [buckets, setBuckets] = useState<LabBucketDetail[]>([]);
  const [newBucketName, setNewBucketName] = useState("");
  const [selectedBucketIdForNote, setSelectedBucketIdForNote] = useState("");
  const [manualNoteText, setManualNoteText] = useState("");
  const [metrics, setMetrics] = useState<{
    hit_at_1: number;
    hit_at_3: number;
    mrr: number;
    fallback_rate: number;
    p95_latency_ms: number;
    traces: number;
    decisions: number;
  } | null>(null);
  const [traceRows, setTraceRows] = useState<LabTrace[]>([]);

  async function onCreateRun() {
    setStatus("Creating run...");
    try {
      const out = await createRun({
        tester_id: testerId,
        algorithm_version: algorithmVersion,
        dataset_source: "default_fixture"
      });
      setRunId(out.run.run_id);
      setStatus(`Run ready: ${out.run.run_id}`);
      setMetrics(null);
      setTraceRows([]);
      setLatestTrace(null);
      setBuckets([]);
      await refreshState(out.run.run_id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create run");
    }
  }

  async function onRunCapture() {
    if (!runId) {
      setStatus("Create a run first.");
      return;
    }
    if (!captureText.trim()) {
      setStatus("Enter capture text before running suggestion.");
      return;
    }
    setStatus("Running ranking...");
    try {
      const out = await runCaptureTest(runId, captureText.trim());
      setLatestTrace(out.trace);
      setStatus(`Trace ${out.trace.trace_id} created.`);
      await refreshRun();
      await refreshState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Capture test failed");
    }
  }

  async function onQuickSelectCandidate(collectionId: string, rank: number) {
    if (!runId || !latestTrace) return;
    setStatus("Saving decision...");
    try {
      await submitDecision(runId, {
        trace_id: latestTrace.trace_id,
        selected_kind: "collection",
        selected_collection_id: collectionId,
        selected_collection_note_count:
          latestTrace.candidates.find((c) => c.collection_id === collectionId)?.collection_note_count ?? null,
        selected_rank: rank,
        failure_reason: rank === 1 ? "correct_top1" : "near_miss_top3"
      });
      setStatus(`Decision saved from quick select (rank ${rank}).`);
      await refreshRun();
      setCaptureText("");
      setLatestTrace(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Decision save failed");
    }
  }

  async function onQuickSelectCreateNew() {
    if (!runId || !latestTrace) return;
    setStatus("Saving create-new decision...");
    try {
      await submitDecision(runId, {
        trace_id: latestTrace.trace_id,
        selected_kind: "create_new",
        selected_collection_id: null,
        selected_collection_note_count: null,
        selected_rank: null,
        failure_reason: "should_create_new"
      });
      setStatus("Create-new decision saved.");
      await refreshRun();
      setCaptureText("");
      setLatestTrace(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Decision save failed");
    }
  }

  async function refreshRun() {
    if (!runId) return;
    const [metricRes, traceRes] = await Promise.all([fetchMetrics(runId), fetchTraces(runId)]);
    setMetrics(metricRes.metrics);
    setTraceRows(traceRes.traces.slice().reverse());
  }

  async function refreshState(explicitRunId?: string) {
    const rid = explicitRunId ?? runId;
    if (!rid) return;
    const out = await fetchState(rid);
    setBuckets(out.buckets);
    if (!selectedBucketIdForNote && out.buckets[0]) {
      setSelectedBucketIdForNote(out.buckets[0].id);
    }
  }

  async function onAddBucket() {
    if (!runId) {
      setStatus("Create a run first.");
      return;
    }
    if (!newBucketName.trim()) {
      setStatus("Enter a bucket name.");
      return;
    }
    setStatus("Adding bucket...");
    try {
      await addBucket(runId, newBucketName.trim());
      setNewBucketName("");
      setStatus("Bucket added.");
      await refreshState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed adding bucket");
    }
  }

  async function onAddManualNote() {
    if (!runId) {
      setStatus("Create a run first.");
      return;
    }
    if (!selectedBucketIdForNote) {
      setStatus("Select a target bucket first.");
      return;
    }
    if (!manualNoteText.trim()) {
      setStatus("Enter note text to insert.");
      return;
    }
    setStatus("Adding note to bucket...");
    try {
      await addNote(runId, {
        collection_id: selectedBucketIdForNote,
        text: manualNoteText.trim()
      });
      setManualNoteText("");
      setStatus("Note inserted.");
      await refreshState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed adding note");
    }
  }

  return (
    <div className="layout">
      <header>
        <h1>Ranking Lab</h1>
        <p>Local observability dashboard for collection ranking tests.</p>
      </header>

      <section className="card">
        <h2>Step 1 - Create Run and Buckets</h2>
        <div className="grid">
          <label>
            Tester ID
            <input value={testerId} onChange={(e) => setTesterId(e.target.value)} />
          </label>
          <label>
            Algorithm Version
            <input value={algorithmVersion} onChange={(e) => setAlgorithmVersion(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button onClick={onCreateRun}>Create Run</button>
        </div>
        <div className="row">
          <input
            placeholder="New bucket name"
            value={newBucketName}
            onChange={(e) => setNewBucketName(e.target.value)}
          />
          <button onClick={onAddBucket}>
            Add Bucket
          </button>
        </div>
        <p className="muted">Run ID: {runId || "-"}</p>
        <p className="muted">
          Existing buckets: {buckets.length} | Total notes: {buckets.reduce((s, b) => s + b.note_count, 0)}
        </p>
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Notes</th>
              <th>Notes Detail</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const notes = Array.isArray((b as { notes?: unknown }).notes) ? (b as { notes: string[] }).notes : [];
              return (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.note_count}</td>
                  <td>
                    <details>
                      <summary>View notes ({notes.length})</summary>
                      {notes.length === 0 ? (
                        <p className="muted">No notes yet.</p>
                      ) : (
                        <ul className="note-list">
                          {notes.map((n, i) => (
                            <li key={`${b.id}-${i}`}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Step 2 - Add Notes Manually</h2>
        <div className="grid">
          <label>
            Target Bucket
            <select value={selectedBucketIdForNote} onChange={(e) => setSelectedBucketIdForNote(e.target.value)}>
              <option value="">Select bucket</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Manual Note Text
          <textarea rows={3} value={manualNoteText} onChange={(e) => setManualNoteText(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={onAddManualNote}>
            Insert Manual Note
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Step 3 - Capture + Tracing</h2>
        <label>
          Capture Text
          <textarea rows={4} value={captureText} onChange={(e) => setCaptureText(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={onRunCapture}>
            Run Suggestion
          </button>
          <button onClick={refreshRun} disabled={!runId}>
            Refresh Metrics
          </button>
        </div>

        {latestTrace ? (
          <>
            <h3>Latest Ranked Candidates</h3>
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Collection</th>
                  <th>Notes</th>
                  <th>Display Score</th>
                  <th>Semantic</th>
                  <th>Fused</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {latestTrace.candidates.map((c) => (
                  <tr key={c.collection_id}>
                    <td>{c.rank}</td>
                    <td>{c.collection_name}</td>
                    <td>{c.collection_note_count}</td>
                    <td>{c.score.toFixed(3)}</td>
                    <td>{c.semantic_score.toFixed(3)}</td>
                    <td>{c.fused_score.toFixed(3)}</td>
                    <td>
                      <button type="button" onClick={() => onQuickSelectCandidate(c.collection_id, c.rank)}>
                        Select this
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button type="button" onClick={onQuickSelectCreateNew}>
                Select Create New
              </button>
            </div>
            <p className="muted">Selecting an option above saves decision and clears capture for next test.</p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Session Metrics</h2>
        {metrics ? (
          <div className="metric-grid">
            <Metric label="Traces" value={metrics.traces.toString()} />
            <Metric label="Decisions" value={metrics.decisions.toString()} />
            <Metric label="Hit@1" value={`${(metrics.hit_at_1 * 100).toFixed(1)}%`} />
            <Metric label="Hit@3" value={`${(metrics.hit_at_3 * 100).toFixed(1)}%`} />
            <Metric label="MRR" value={metrics.mrr.toFixed(3)} />
            <Metric label="Fallback Rate" value={`${(metrics.fallback_rate * 100).toFixed(1)}%`} />
            <Metric label="P95 Latency" value={`${metrics.p95_latency_ms.toFixed(0)} ms`} />
          </div>
        ) : (
          <p className="muted">No metrics yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Recent Traces</h2>
        <table>
          <thead>
            <tr>
              <th>Trace ID</th>
              <th>Source</th>
              <th>Latency</th>
              <th>Top1</th>
              <th>Margin</th>
              <th>Capture</th>
            </tr>
          </thead>
          <tbody>
            {traceRows.slice(0, 20).map((t) => (
              <tr key={t.trace_id}>
                <td>{t.trace_id.slice(0, 12)}...</td>
                <td>{t.source}</td>
                <td>{t.latency_ms} ms</td>
                <td>{t.top1_score?.toFixed(3) ?? "-"}</td>
                <td>{t.margin?.toFixed(3) ?? "-"}</td>
                <td>{t.entry_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="muted">{status}</footer>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
    </div>
  );
}
