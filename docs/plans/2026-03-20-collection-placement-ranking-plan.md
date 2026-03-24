# Collection placement & ranking plan (embedding + collection memory)

**Date:** 2026-03-20  
**Status:** Phase 1 **wired** in `SuggestionService` (batch embed per request + rolling previews; **no** persisted `profile_embedding` cache yet).  
**Related:** `2026-03-20-ai-assisted-note-collection-system-design.md`, `categorization-prompt.ts` (prompt only; not wired)

---

## 1. Purpose

Define a **phased** approach to **ranking collections** (and “create new”) when the user reviews a capture, so that:

- **Vague, short notes** (1–2 lines, no titles) can still match the right **project-style** bucket when that bucket has **shared context** accumulated over time.
- **Cost and latency** stay controlled: **Stage A (retrieval + heuristics) first**; **Stage B (LLM) only when needed**.
- The design fits **note shapes** in this product: free text, optional `image_context`, occasional long pastes.

---

## 2. Problem framing

| Reality | Implication |
|--------|-------------|
| Notes are often **not** lexically similar to each other but belong to one mental “project.” | **Note-only ↔ note-only** similarity is weak; we need a **collection-side anchor**. |
| No note titles; body may be **very short** or **long paste**. | Rolling memory must use **truncated previews**, not “titles.” |
| Current backend ranks by **recent hint ids + `last_activity_at`** with **positional scores**; **no** embedding or LLM in the suggestion path today. | This plan **replaces the core ranker** while keeping **recency/corrections** as **re-ranking signals**. |

---

## 3. Phased decision (locked)

| Phase | What | When |
|-------|------|------|
| **Phase 1** | **Hybrid Stage A**: collection **profile text** (stable + rolling) → **embed query vs profile** → **shortlist** → **behavioral re-rank** → **confidence / UX rules** | **Ship first** |
| **Phase 2** | **Stage B (small LLM)**: reuse structured prompt (`buildCategorizationPrompt`) on **top K candidates only**, gated by **ambiguity / low confidence** | Add when metrics justify cost |
| **Deferred** | Full agentic pipeline, resurfacing, graph-native routing | Out of scope until complexity + evals justify |

**Principle:** Embeddings are the **similarity engine**; **collection memory** is the **glue** for implicit project intent.

---

## 4. Phase 1 — Full specification

### 4.1 Collection profile (“memory”) — two layers

**Product constraint:** **No user-filled “collection intent” or description field** in the app — keep cognitive load low. Ranking must work from **name + behavior + auto memory** only.

**A. Stable profile (from user, minimal)**

- Collection **name** only (required today).

**B. Rolling profile (auto, recency-biased)**

- Built from the **last K notes** in that collection (K configurable, e.g. 15–30).
- For each note, take a **preview**:
  - If short: use **full text** (still cap max chars per note, e.g. 200–300).
  - If long: **head preview** (first N chars or N tokens), then `…`.
- Concatenate into a single text block with **hard total token/char budget** (e.g. truncate oldest lines first if over budget).
- **Refresh policy:** on each note **confirmed into** the collection (or async job every M minutes) — avoid recomputing entire history.

**Optional compression (still Phase 1 if cheap):** periodically replace rolling raw previews with a **2–3 sentence LLM summary** (batched / infrequent) — not required to ship Phase 1.

### 4.2 Query text for embedding (capture side)

Embed **one string** per suggestion request, e.g.:

- Draft **text preview** (as today from `getDraftTextPreview`).
- Append **`image_context`** when present (image flow only).
- Optional future: **active / pinned collection** hint text (if product adds it).

**Rule:** Everything you want the model to “know” must appear **in this string or in the collection profile** — embeddings do not read the user’s mind.

### 4.3 Vectors and similarity

- **One embedding per collection profile** per suggestion model version:  
  `embed(f(stable_text + rolling_previews))` with `f` = concat + budget limits.
- **One embedding per query** per request: `embed(query_text)`.
- **Similarity:** cosine (or dot product on normalized vectors).
- **Model:** start with **`text-embedding-3-small`** (cost); revisit if quality insufficient.
- **Storage:** persist `profile_embedding`, `profile_text_hash` or `updated_at`, and **`embedding_model` id** so stale vectors can be recomputed after model/content changes.

### 4.4 Ranking pipeline (order of operations)

1. **Filter / cap universe** (optional): if user has many collections, pre-cap to a reasonable set (e.g. all active in last N days + any in `recent_collection_ids`) to bound embedding comparisons — tune with data.
2. **Semantic shortlist:** sort by similarity score; take **top K** (e.g. 8–12).
3. **Behavioral re-rank** (within shortlist or full list — product choice):
   - Boost ids in `hints.recent_collection_ids` (order preserved as tie-breaker).
   - Boost higher **`last_activity_at`** (momentum).
   - Boost collections where user **recently confirmed** placements (from `placement_actions` / events when available).
4. **Scores for API/UI:** map fused rank to a **monotonic score** (or keep raw similarity + label separately). Align with existing `confidence_policy_v1` thresholds where possible.
5. **“Create new”** option: always present; suggested name from **preview words** (current behavior) unless replaced by Phase 2.

### 4.5 Confidence & UX (align with existing policy)

- **High separation** (top vs runner-up): treat as **stronger** suggestion.
- **Flat or low similarity:** avoid aggressive auto-select; emphasize **create new** + **recents** (matches “uncertain” behavior in PRD/design docs).
- Expose **`source`** in API: e.g. `semantic_heuristic` vs `llm` (Phase 2) vs `fallback` (OpenAI/embed failure).

### 4.6 Failure modes

- **Embeddings unavailable** (API error, no key): fall back to **current** heuristic path (`orderCollections` + positional scores) — already similar to `buildFallback`.
- **Cold start:** no notes in collection → profile = **collection name** only (still embedded / lexical-matched).
- **Empty collections list:** keep existing **cold_start** suggestions.

### 4.7 Data & schema (implementation checklist)

- [ ] `collections` (or side table): optional **server-side** fields for ranking cache only — e.g. `profile_text_rolling`, `profile_text_combined`, `profile_embedding`, `embedding_model`, `profile_updated_at`. (A legacy DB `description` column may exist for other products; **this app does not collect user intent text** for collections.)
- [ ] On note placement / move: **update rolling previews** and **invalidate or refresh** embedding (async acceptable).
- [ ] Migration + backfill: compute rolling text + embeddings for existing collections (batch).

### 4.8 Backend code touchpoints (current repo)

- `SuggestionService.buildModel` / `buildFallback`: replace “positional fake model” with **Phase 1 pipeline** above.
- New module e.g. `embedding-rank.ts` + OpenAI embeddings client (reuse API key pattern from `openai-extract.ts`).
- `NoteRepository`: methods to load **last K note previews** per collection; optional persisted embedding columns on collection rows (not exposed on `CollectionSummary` unless needed for debugging).
- Tests: `suggestions.test.ts` — fixtures with known profiles and query text → expected order; fallback when embed fails.

### 4.9 Mobile / client

- Continue sending **`hints.recent_collection_ids`** (re-rank input).
- No requirement for titles; **no change** to capture shape beyond existing preview + `image_context` on image path.

### 4.10 Offline ranking evaluation (automated + manual)

- **Harness:** `backend/src/ranking-eval-harness.ts` seeds a fake user, collections, and placed notes from JSON, runs **`SuggestionService.buildSuggestions`** (full ranking path), and scores **Hit@1 / Hit@3 / Hit@5 / MRR** vs `expected_collection_name` per case.
- **CLI:** from `backend/`, `npm run eval:ranking` (default `test/fixtures/ranking-eval-smoke.json`). Options: `--fixture <path>`, `--stress --limit N` (15 themed buckets × many notes), `--json` for machine-readable output.
- **CI-safe test:** `test/ranking-eval-harness.test.ts` injects **`embedBatch`** so ranking is deterministic without OpenAI.
- **Stronger signal:** set `OPENAI_API_KEY` when running the CLI to use real embeddings (cost scales with collections × cases).
- **Gold data:** extend JSON or stress generator; for production-grade labels, curate (query, expected collection) from real traffic or synthetic + human audit.

---

## 5. Phase 2 — LLM rerank (optional gate)

**Trigger examples (pick one or combine):**

- Top similarity **&lt; T_low**, or **top − second &lt; T_margin**.
- User taps **“Better suggestions.”**
- Power-user setting: always on (not default).

**Inputs (strict caps):**

- Note preview + optional `image_context`.
- **Only top K collections**: id, **name**, **1–2 line** rolling snippet (no separate user “intent” text).
- Reuse **`buildCategorizationPrompt`** output shape; validate JSON.

**Outputs:** map to existing suggestion response (`top_choice`, alternatives, `reason_short`, confidence).

**Cost control:** 1 small chat call per gated request; log tokens.

---

## 6. Success metrics (before/after Phase 1)

- **Top-1 accuracy** (user keeps suggestion vs changes collection).
- **Override rate** and **time-to-confirm**.
- **Latency p95** for suggestions endpoint.
- **Embedding $/MAU** and **error rate** (fallback frequency).

---

## 7. Explicit non-goals (for this document)

- Replacing the entire pipeline with a **single open-ended agent**.
- **Resurfacing** / proactive digests (deferred per product).
- Training **custom** embedding models (use hosted unless later justified).

---

## 8. Summary one-liner

**Embed collection memory (name + auto last-K previews) vs augmented capture text; re-rank with recency and user behavior; add a small LLM rerank only when scores are ambiguous — no extra user fields on collections.**
