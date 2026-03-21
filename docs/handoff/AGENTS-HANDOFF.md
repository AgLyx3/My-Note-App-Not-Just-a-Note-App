# Agent Handoff Playbook (MVP Implementation)

## Purpose
Operational guide for delegating implementation with specialized subagents while preserving contract safety, TDD discipline, and review quality.

## Subagents Created
- `.cursor/agents/frontend-implementer.md`
- `.cursor/agents/backend-implementer.md`
- `.cursor/agents/qa-tdd-enforcer.md`
- `.cursor/agents/code-review-gate.md`

## Canonical document priority
When docs conflict, always follow this order:
1. `docs/api/2026-03-20-ai-note-v1-api-contract.md`
2. `docs/db/2026-03-20-ai-note-v1-db-migration-spec.md`
3. `docs/plans/2026-03-20-ai-assisted-note-collection-system-design.md`
4. `docs/plans/2026-03-20-ai-assisted-note-collection-mobile-ui-design.md`
5. `docs/plans/2026-03-20-ai-assisted-note-collection-prd.md`

If conflict occurs, pick the highest-priority doc and proceed. Record decision in task notes.

## Implementation sequence (recommended)
1. Backend foundation:
   - migrations + RLS + auth middleware + API skeleton
2. Contract-complete backend endpoints:
   - captures, suggestions, confirm, move, undo, feed, collection entries, events
3. Frontend core flow:
   - capture -> review -> confirm
4. Recovery and quality paths:
   - undo, move, fallback source states, cold-start states
5. Final hardening:
   - perf checks, error handling, a11y checks, logging integrity

## TDD operating rules
- Write failing tests first (or in same slice before claiming completion).
- No module is complete without green tests and targeted regression checks.
- QA gate must run after each module batch and before integration.
- **Module gates (PASS/FAIL + commands):** `docs/handoff/TDD-TEST-GATES-CHECKLIST.md`
- **Requirement → test matrix:** `docs/qa/2026-03-20-requirement-to-test-traceability-matrix.md`

## Required gates per module
- Build passes
- Relevant tests pass
- Lint/type checks pass
- Contract compatibility check passes
- QA gate status is PASS
- Code review verdict is not BLOCK/REQUEST_CHANGES

## Module definition of done
- Feature behavior matches canonical docs
- Test evidence provided (what was added and what passed)
- No unresolved high/critical review findings
- Any doc conflicts resolved with explicit source priority reference

## Suggested parallelization model
- Stream A: backend-implementer
- Stream B: frontend-implementer
- Continuous: qa-tdd-enforcer checks both streams
- End of each module batch: code-review-gate

## Delegation prompt templates

### Backend
Use `backend-implementer` to implement [module name] per API and DB specs. Follow strict TDD, include contract tests, idempotency tests, and undo invariants. Resolve doc conflicts using canonical priority.

### Frontend
Use `frontend-implementer` to implement [screen/flow] per UI and API specs. Follow strict TDD, include fallback/cold-start states and accessibility checks. Resolve doc conflicts using canonical priority.

### QA
Use `qa-tdd-enforcer` to run gate checks for [module name], report PASS/FAIL with severity, and provide exact remediation actions.

### Review
Use `code-review-gate` to review [module batch] and produce severity-ordered findings and a final verdict.

