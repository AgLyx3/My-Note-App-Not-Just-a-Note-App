# Analytics, telemetry & metrics plan

**Date:** 2026-03-22  
**Scope:** Key UX flow, LLM-involved steps, event traces, retention/DAU, implementation order.

---

## 1) System map (product + LLM)

### Core UX funnel (mobile → backend)

| Step | UX | Backend / AI |
|------|-----|----------------|
| 1 | **Capture** — text vs image; optional `image_context` (image path only) | `POST /v1/captures` creates draft |
| 2 | **Image OCR** (if user used image) | `POST /v1/extract-text` — **OpenAI vision/chat** (requires key) |
| 3 | **Continue** → navigate to Review | Same capture payload; text + optional context stored |
| 4 | **Review** — load ranked options | `POST /v1/captures/:id/suggestions` — **embeddings** (OpenAI `text-embedding-3-small` if key, else lexical) + fusion + fallback |
| 5 | User picks collection or **create new** | `POST /v1/captures/:id/confirm` |
| 6 | Optional **undo / move** | placement stubs |

### “LLM for decision” today

- **Ranking / placement suggestion:** not a chat LLM — **vector similarity + behavioral boosts**; optional **OpenAI Embeddings API**. On failure → **fallback** heuristic (`source: fallback`).
- **Vision extract:** **separate** OpenAI chat+image call — turns image → text for editing; not choosing a collection.
- **Future (Phase 2):** `buildCategorizationPrompt` — **small LLM rerank** when ambiguous; **not wired** yet.

**Product implication:** Instrument **both** “model-assisted” paths (vision + embeddings) and **human decisions** (accept vs change vs create new) to judge quality and cost.

---

## 2) Event traces to log (behavior + system)

Use a **small, stable vocabulary** of events. Prefer **server-side** for anything tied to API success/failure/latency; **client-side** for navigation and taps before network.

**Privacy:** log **hashes or buckets** for raw text; never log full note body in analytics. Log `entry_id` only in secure internal logs if needed for joins, not in third-party tools.

### A. Capture & extract (LLM: vision)

| Event | Who | Key properties |
|-------|-----|----------------|
| `capture_created` | Server | `entry_id`, `user_id`, `type` (text \| image pipeline as text), `text_length_bucket`, `has_image_context`, `has_image_storage_path` |
| `extract_text_requested` | Server | `user_id`, `mime_type`, `image_bytes_bucket` |
| `extract_text_succeeded` | Server | `latency_ms`, `model` (from env), `response_text_length_bucket` — add **`prompt_tokens` / `total_tokens`** when API returns them |
| `extract_text_failed` | Server | `latency_ms`, `error_class` (no_key \| http_4xx \| http_5xx \| timeout) |

### B. Suggestions (LLM-ish: embeddings + future chat rerank)

| Event | Who | Key properties |
|-------|-----|----------------|
| `suggestions_requested` | Server | `entry_id`, `user_id`, `collection_count`, `has_recent_hints` |
| `suggestions_succeeded` | Server | `latency_ms`, `source` (model \| fallback \| cold_start), `top_kind` (collection \| create_new), `top_collection_id` (if any), `confidence_label`, `confidence_score`, `used_openai_embedding` (bool), `profile_count_embedded` |
| `suggestions_failed` | Server | `latency_ms`, `error_class` — rare if you always return fallback JSON |

**Optional debug payload (internal table / sampled):** semantic margin (top − second fused score), rank of chosen collection *after* confirm (join in warehouse).

### C. Human decision (quality of ranking)

| Event | Who | Key properties |
|-------|-----|----------------|
| `review_screen_viewed` | Client | `entry_id`, `time_to_first_paint_bucket` (optional) |
| `placement_confirmed` | Server | `entry_id`, `user_id`, `selected_kind` (collection \| create_new), **`matched_top_suggestion`** (bool), `rank_of_selected` if not top (requires client send `selected_rank` or server infers from last suggestions — prefer **client** sending `suggestion_rank_selected` 1-based), `collection_id` if existing |
| `placement_undo` / `entry_moved` | Server | ids, `from_collection_id`, `to_collection_id` |

**North-star quality metric:** `P(top_suggestion_accepted)` and **override rate** = 1 − that.

### D. Engagement & retention inputs

| Event | Who | Key properties |
|-------|-----|----------------|
| `session_start` / `app_open` | Client | `app_version`, `os` |
| `active_day` | Derived | From any authenticated event per calendar day |

---

## 3) Important metrics (what to actually chart)

### Growth & retention

| Metric | Definition | Primary use |
|--------|------------|-------------|
| **DAU / WAU / MAU** | Distinct `user_id` with ≥1 meaningful event/day/week/month | Health |
| **D1 / D7 / D30 retention** | % of cohort (e.g. first `capture_created`) active on day N | PMF / onboarding |
| **New vs returning** | First-ever event date bucket | Acquisition vs habit |

### Funnel (core habit)

| Stage | Event basis |
|-------|-------------|
| Open app | `app_open` |
| Started capture | `capture_created` (or tap intent if you add client event) |
| Reached review | `suggestions_requested` or `review_screen_viewed` |
| Finished | `placement_confirmed` |

**Conversion:** capture → confirm; review load → confirm; time-in-review (latency distribution).

### AI & cost

| Metric | Source |
|--------|--------|
| **Suggestion source mix** | % `model` / `fallback` / `cold_start` |
| **OpenAI embedding usage** | Count `suggestions_succeeded` where `used_openai_embedding` |
| **Vision usage** | Count `extract_text_succeeded` |
| **Estimated spend** | Tokens × price (once you log tokens on vision + embeddings from API responses) |
| **Ranking quality** | `matched_top_suggestion` rate, distribution of `rank_of_selected` |

### Reliability

- p50/p95 **latency** for `suggestions_*` and `extract_text_*`
- Error rates by `error_class`

---

## 4) What to implement **first** (priority order)

**Principle:** Ship **one pipeline** you trust (server-authoritative for API outcomes), then enrich. Don’t block on a perfect warehouse.

1. **Stable `user_id`** — real auth or dev token; document that analytics keys off it.
2. **Server-side events for API paths** — `capture_created`, `extract_*`, `suggestions_*`, `placement_confirmed` — single `event_logs` insert or stdout JSON for dev.
3. **Latency + `source` + `matched_top_suggestion`** — minimal schema to answer “is ranking useful?” and “is OpenAI path used?”
4. **Client: `review_screen_viewed` + `suggestion_rank_selected` on confirm** — unlock funnel + acceptance without guessing.
5. **Token logging** on OpenAI responses (vision + embeddings) — unlock cost dashboards.
6. **Warehouse / BI** (Supabase → export, Metabase, BigQuery) + retention SQL.
7. **Product analytics SDK** (PostHog / Amplitude / GA4) **or** stay first-party on `event_logs` per existing DB spec.

---

## 5) Implementation plan (phased)

### Phase 0 — Spec & privacy (0.5–1 day)

- Finalize event names + property JSON schema (version `analytics_schema_v1`).
- Redaction rules: no raw capture text in analytics payloads.
- If EU users: consent banner scope for analytics (even first-party).

### Phase 1 — Backend instrumentation (1–2 days)

- Add thin `analytics.ts` helper: `logEvent({ name, userId, properties })`.
- **In-memory:** append to array + optional `console.log` JSON in dev.
- **Postgres (when migrated):** insert into `event_logs` per `docs/db/...` spec.
- Instrument routes: `captures`, `extract-text`, `captures/:id/suggestions`, `captures/:id/confirm`.
- Return **`suggestion_request_id`** or echo **`entry_id`** so client can send `rank_selected` on confirm (or store last suggestions server-side keyed by entry — more coupling).

### Phase 2 — Client instrumentation (1 day)

- On Review mount: `review_screen_viewed`.
- On confirm: include **`selected_suggestion_rank`** (1 = top, 2 = first alt, …) and **`top_option_id` snapshot** or server compares to last suggestions response (server-side compare is better: store last ranking in Redis/memory with TTL for entry).

**Better pattern:** Server stores `last_suggestions_result` in memory keyed by `entry_id` (TTL 1h); on confirm, server computes `matched_top_suggestion` without trusting client.

### Phase 3 — Tokens & cost (0.5–1 day)

- Parse OpenAI usage from vision + embeddings responses; attach to `extract_text_succeeded` / `suggestions_succeeded` properties.

### Phase 4 — Dashboards (ongoing)

- SQL or Metabase: DAU, funnel, retention cohorts, acceptance rate, fallback %, p95 latency.
- Alert: spike in `fallback` or `extract_text_failed`.

### Phase 5 — Phase 2 LLM rerank (when built)

- New events: `suggestions_llm_rerank_requested`, `suggestions_llm_rerank_succeeded` with token usage and `trigger_reason` (low_margin \| user_tap).

---

## 6) References

- `docs/db/2026-03-20-ai-note-v1-db-migration-spec.md` — `event_logs` table sketch  
- `docs/plans/2026-03-20-collection-placement-ranking-plan.md` — ranking pipeline  
- `mobile-app/app/review.tsx`, `capture.tsx` — funnel touchpoints  

---

## 7) One-line summary

**Log server-side capture → extract → suggestions → confirm with latency, suggestion `source`, and whether the user picked the top rank; add DAU/retention from daily active users; layer token usage for cost; warehouse second.**
