# UI/UX and Prompt Optimization Notes

## Scope
- Keep product spec and core idea unchanged.
- Optimize via system thinking in two areas:
  1) UI/UX decision flow and visual hierarchy
  2) organization prompt quality and ambiguity handling

## UI/UX optimization (system view)

### 1) Keep one stable decision surface
- Use the same review sheet component for both initial placement and move flow.
- Reuse confidence label + option ordering logic so users do not relearn behavior.

### 2) Deterministic preselection policy
- `likely` and `possible` -> preselect top collection.
- `uncertain`, `fallback`, or `cold_start` -> prefer `create_new` if present.
- This lowers correction cost and matches PRD cognitive-load goals.

### 3) Option budget hard cap
- Show max 5 options total:
  - top option + up to 3 alternatives + create-new.
- Prevents choice overload and keeps tap targets large.

### 4) Empty-state and cold-start consistency
- If user has zero collections, force top option to create-new with inferred names.
- Avoid showing "dead" collection picker in first-run experience.

### 6) Capture input simplification
- Capture surface should only expose input by format: `text` or `image`.
- URLs are entered in text naturally and processed by backend enrichment/crawl.
- This removes unnecessary mode choice (note vs link vs screenshot) and lowers cognitive load.

### 5) Feedback loop clarity
- Confirm -> immediate success + Undo action.
- Keep Undo visible for a short window; move remains available in collection detail.

## Prompt optimization (organization quality)

### 1) Strict output contract
- Prompt now enforces pure JSON, schema, no markdown, no invented collection IDs.

### 2) Uncertainty-first guardrail
- Prompt explicitly instructs CREATE_NEW when evidence is weak.
- This reduces false-positive auto-routing and protects trust.

### 3) Correction-history feedback
- Prompt includes recent correction hints to reduce repeated misclassification.

### 4) Candidate boundedness
- Prompt receives only candidate collections and must rank from that set.
- Lowers hallucination risk and improves explainability.

## Synthetic random-note sanity check

Using a synthetic random-note set (travel, shopping, work, learning, health, finance, personal, ambiguous), the evaluator script reports category decisions and aggregate accuracy.

Run:

```bash
cd backend
npm run eval:categorization
```

Use this as a regression check when tuning prompt wording, thresholds, or confidence policy.

## Artifacts added
- `docs/uiux/ui-review-prototype.html` (visual review prototype for screenshot checks)
- `backend/src/categorization-prompt.ts` (prompt builder)
- `backend/scripts/evaluate-categorization.ts` (sanity evaluator on random notes)
- `backend/test/categorization-prompt.test.ts` (prompt contract tests)
