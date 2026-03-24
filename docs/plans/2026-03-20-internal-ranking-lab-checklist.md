# Internal Ranking Lab (Local Web App) - Checklist + Dashboard Plan

**Date:** 2026-03-20  
**Goal:** Fast local tool for testing collection ranking quality with high observability.  
**Scope:** Text-only captures (no image path). Local-only web app, no deployment needed.

---

## 1) Success Criteria For This Internal Tool

- You can generate or load synthetic collections/notes in under 2 minutes.
- You can run capture -> suggestions -> user selection loops without mobile UI friction.
- Every ranking request records full trace context (inputs, candidate scores, rank order, latencies).
- You can review quality and drift from a dashboard without exporting logs.
- You can compare algorithm versions with repeatable fixture runs.

---

## 2) Ready-To-Use Test Checklist

Use this as the operating checklist for each test session.

### A. Session Setup (5 min)

- [ ] Start backend (`npm run dev:run` in `backend/`).
- [ ] Start ranking lab web app.
- [ ] Select dataset mode:
  - [ ] `Default synthetic` (recommended baseline), or
  - [ ] `Prompt-generated buckets/notes`.
- [ ] Set run metadata:
  - [ ] `run_id` (e.g. `2026-03-20-manual-01`)
  - [ ] `algorithm_version` (git SHA or tag)
  - [ ] `embedding_mode` (`openai` or `lexical-fallback`)
  - [ ] `tester_id`
- [ ] Confirm logging is enabled (traces + interactions).

### B. Data Readiness Check (2 min)

- [ ] Collections >= 5 present.
- [ ] Notes per collection roughly balanced enough for test objective.
- [ ] At least one ambiguous pair of collections exists (overlapping terms).
- [ ] At least one sparse/new collection exists.

### C. Run Manual Ranking Loop (15-20 min)

Target ~30 captures:

- [ ] 10 obvious captures (easy expected bucket)
- [ ] 10 ambiguous captures (similar vocabulary across buckets)
- [ ] 5 should map to "create new" or weak confidence scenario
- [ ] 5 short/vague captures (1-2 lines)

For each capture:

- [ ] Enter capture text.
- [ ] Inspect ranked suggestions panel (top-5 shown with scores).
- [ ] Select actual best collection (or create new).
- [ ] Tag outcome reason:
  - [ ] correct-top1
  - [ ] near-miss (gold in top-3)
  - [ ] semantic miss
  - [ ] recency over-boost
  - [ ] noisy profile
  - [ ] should-create-new

### D. Post-Run Review (10 min)

- [ ] Check core quality metrics:
  - [ ] Top-1 acceptance
  - [ ] Hit@3
  - [ ] MRR
- [ ] Check reliability/cost metrics:
  - [ ] Fallback rate
  - [ ] Suggestions p95 latency
  - [ ] Estimated embedding tokens per request
- [ ] Review ambiguity diagnostics:
  - [ ] Margin distribution (top1-top2)
  - [ ] Errors by low-margin bucket
- [ ] Review top 10 failure traces with full context.
- [ ] Record optimization hypothesis for next run.

### E. Go/No-Go Gate For Algorithm Change

- [ ] Synthetic regression: no drop in Hit@3, no drop in MRR.
- [ ] Manual run: Top-1 acceptance stable or better.
- [ ] p95 latency not worse beyond agreed threshold.
- [ ] Fallback rate not increased.
- [ ] If degraded, rollback and tag run as rejected.

---

## 3) Metrics To Track In The Lab (Local, Actionable)

### Core Metrics (decision-making)

1. **Top-1 Acceptance**
   - `selected_rank == 1`
   - Measures first-choice usefulness in real interactions.

2. **Hit@3**
   - Gold/selected collection appears in top 3.
   - Measures shortlist quality when top-1 is imperfect.

3. **MRR**
   - Reciprocal rank average over test cases.
   - More sensitive ranking signal than Hit@k alone.

4. **Fallback Rate**
   - `source == fallback` / total.
   - Measures model-path reliability.

5. **p95 Suggestion Latency**
   - Server response time for suggestions.
   - Protects UX and iteration speed.

### AI-Native Diagnostics (optimization)

- **Margin (top1_score - top2_score)** by outcome bucket.
- **Confidence calibration**: confidence bucket vs observed top-1 correctness.
- **Estimated token usage** per request (query + all profile text lengths converted to token estimate).
- **Score component contribution**: semantic vs recency/activity boost.

---

## 4) Internal Dashboard Design (Standalone Local Web App)

## 4.1 Primary User Flow

1. Choose data source (`default synthetic` or `prompt-generated`).
2. Generate/load collections + notes.
3. Enter capture text in testing console.
4. Run suggestions and inspect ranked candidates + trace details.
5. Select actual best collection.
6. Repeat for session; inspect live metrics.
7. Export run report (JSON/CSV/Markdown).

## 4.2 Required Screens

### Screen A - Run Setup

- Run metadata form (`run_id`, tester, algorithm version, mode).
- Dataset controls:
  - Load default fixture
  - Generate by prompt (count of buckets, notes per bucket, ambiguity level)
  - Seed value for reproducibility
- Quick preview table:
  - collection name
  - note count
  - sample profile preview

### Screen B - Capture Test Console

- Input panel: capture text box + optional expected bucket (if known test case).
- Action buttons:
  - `Run Suggestion`
  - `Run + Auto-log`
  - `Next Case`
- Ranked output panel (top-10):
  - rank
  - collection name
  - fused score
  - semantic score
  - recency/activity bonus
- Decision panel:
  - pick selected bucket
  - tag error reason
  - submit outcome

### Screen C - Trace Inspector (High Observability)

- Table with one row per suggestion request:
  - timestamp, run_id, capture preview, source, latency, margin
- Click row -> detail drawer:
  - full query text used for embedding
  - per-candidate profile text snippet used
  - per-candidate score decomposition
  - final ranked order
  - selected bucket and rank selected

### Screen D - Metrics Dashboard

- Session KPI cards:
  - Top-1 acceptance
  - Hit@3
  - MRR
  - Fallback rate
  - p95 latency
- Charts:
  - Margin histogram (correct vs incorrect overlays)
  - Latency distribution
  - Confusion matrix (expected vs selected)
  - Failure reason breakdown

### Screen E - Compare Runs

- Select two runs (A/B).
- Show deltas:
  - Top-1, Hit@3, MRR
  - latency p95
  - fallback rate
  - score margin medians
- Highlight significant regressions in red.

---

## 5) Trace and Event Schema (Minimal But Sufficient)

Use local SQLite (or JSONL first) with these tables.

### `test_run`

- `run_id` (pk)
- `created_at`
- `tester_id`
- `algorithm_version`
- `embedding_mode`
- `dataset_source` (`default_fixture|prompt_generated`)
- `seed`
- `notes`

### `suggestion_trace`

- `trace_id` (pk)
- `run_id` (fk)
- `created_at`
- `entry_text`
- `query_text_used`
- `collection_count`
- `source` (`model|fallback|cold_start`)
- `latency_ms`
- `top1_collection_id`
- `top1_score`
- `top2_score`
- `margin`
- `candidate_payload_json` (ordered list with score decomposition)

### `tester_decision`

- `decision_id` (pk)
- `trace_id` (fk)
- `selected_collection_id` (nullable)
- `selected_rank` (nullable)
- `selected_kind` (`collection|create_new`)
- `expected_collection_id` (nullable)
- `outcome_label` (`correct_top1|near_miss|miss`)
- `failure_reason` (nullable enum)
- `decision_time_ms`

### `run_metrics_snapshot`

- `run_id` (fk)
- `computed_at`
- `top1_acceptance`
- `hit_at_3`
- `mrr`
- `fallback_rate`
- `latency_p95_ms`
- `avg_margin`
- `calibration_json`

---

## 6) Synthetic Data Generator Design (Prompt + Default)

## 6.1 Default Fixture Pack (recommended baseline)

Include 3 deterministic packs:

- **Easy**: distinct topic buckets.
- **Overlap**: similar project domains with shared vocabulary.
- **Ambiguous/Vague**: short captures with weak lexical clues.

Each case should store:

- `capture_text`
- `expected_collection`
- optional `difficulty_tag`

## 6.2 Prompt-Based Generator (internal creativity mode)

Inputs:

- Domain prompt (e.g. "indie hacker projects + personal tasks")
- bucket count (5-30)
- notes per bucket (10-100)
- ambiguity level (low/med/high)
- noise level (typos/abbrev)
- seed

Outputs:

- generated collections
- generated notes per collection
- generated capture test set with expected labels

Guardrails:

- deterministic with seed where possible
- show generation summary before committing to run
- allow manual edit before save

---

## 7) Suggested Local Tech Stack (Fast Build)

- **Frontend:** React + Vite + TypeScript
- **Backend:** existing backend service + small "lab-api" adapter
- **Storage:** SQLite (via Prisma or Drizzle) for traces and run history
- **Charts:** Recharts or ECharts
- **Exports:** JSON + CSV + Markdown report

No deployment required: run all services locally.

---

## 8) Phased Build Plan (Internal Tool)

### Phase 0 - 1 day (MVP observability)

- Build Run Setup + Capture Console.
- Log suggestion trace + tester decision to SQLite.
- Show basic top-1/Hit@3/MRR and latency p95 cards.

### Phase 1 - 2-3 days (useful optimization loop)

- Add Trace Inspector with score decomposition.
- Add failure tagging and reason breakdown.
- Add run comparison A vs B.

### Phase 2 - optional (deeper evaluation)

- Add prompt generator controls.
- Add confidence calibration chart.
- Add batch replay mode for saved test cases.

---

## 9) Weekly Optimization Rhythm

- Run fixed default fixture pack after each ranking change.
- Run one 30-case manual session in the lab.
- Review top failures and margin bins.
- Apply one algorithm change category at a time.
- Re-run and compare against previous baseline.
- Promote only if quality improves without latency/reliability regression.

---

## 10) Definition Of Done (for this internal tool)

- One command starts local web app.
- Tester can execute end-to-end ranking sessions without phone UI.
- Every suggestion has inspectable trace context and candidate scores.
- Metrics dashboard updates in near-real-time.
- Run comparison supports optimization decisions.
- Exportable report exists for each session.

