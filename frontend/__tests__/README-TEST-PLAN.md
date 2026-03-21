# Frontend stream — test plan placeholder

**Status:** No app runner is wired in this repo yet. Use this as the checklist when scaffolding the client.

## Contract alignment
- Generated or hand-written client types must match `docs/api/2026-03-20-ai-note-v1-api-contract.md`.
- E2E tests should use the same base path `/v1` and real headers (`Authorization`, `Idempotency-Key` on mutations).

## Planned suites (TDD order)
1. **API client unit tests** — serialization, error envelope parsing, idempotency key generation.
2. **Review sheet** — `source`: `model` | `fallback` | `cold_start` renders without treating fallback as failure.
3. **Confidence UI** — `likely` / `possible` / `uncertain` behavior per system design §5.3.
4. **E2E critical paths** — capture → suggestions → confirm; confirm → undo; move entry.

## Suggested commands (to fill when package exists)
```bash
# Example placeholders — replace with actual scripts
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

## Traceability
See `docs/qa/2026-03-20-requirement-to-test-traceability-matrix.md` section **G) Frontend / mobile stream**.
