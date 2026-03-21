# Requirement → Test Traceability Matrix (AI Note v1)

## Document control
- **Date:** 2026-03-20  
- **Sources:**  
  - `docs/api/2026-03-20-ai-note-v1-api-contract.md`  
  - `docs/plans/2026-03-20-ai-assisted-note-collection-system-design.md`  
- **Purpose:** Map contract and system-design requirements to test types and concrete test artifacts. Use during TDD to ensure no requirement ships without a named test home.

## Legend
| Column | Meaning |
|--------|---------|
| **Req ID** | Stable id for PRs and gates (`API-*` = contract, `SYS-*` = system design). |
| **Test type** | Unit (U), Contract/API (C), Integration (I), E2E/mobile (E), Non-functional (N). |
| **Artifact** | File, suite, or checklist row where the test lives or will live. |
| **Status** | `implemented` = automated test exists in repo; `planned` = gate still expects coverage before claiming done. |

---

## A) API conventions and cross-cutting (`api-contract` §1, §4–§6)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| API-1.1 | §1.1 | Base `/v1`, user-scoped context | C | `backend/test/*routing*.test.ts` (planned) | planned |
| API-1.2 | §1.2 | `Authorization: Bearer`; invalid/missing → 401 + `UNAUTHORIZED` | C | `backend/test/captures.test.ts` | implemented |
| API-1.3 | §1.3 | `application/json` request/response | C | Per-route inject tests | planned |
| API-1.4 | §1.4 | ISO 8601 UTC timestamps in responses | U/C | Schema/response snapshot tests | planned |
| API-1.5 | §1.5 | Idempotency-Key required on confirm, move, undo; replay semantics | C/I | `backend/test/idempotency*.test.ts` (planned) | planned |
| API-1.6 | §1.6 | Standard error envelope shape (`error.code`, `message`, `details`, `request_id`) | C | Error contract tests per route | planned |
| API-4 | §4 | Correct HTTP status mapping (400/401/403/404/409/422/429/5xx) | C | Status matrix tests per endpoint | planned |
| API-5 | §5 | Application error codes (`VALIDATION_ERROR`, `IDEMPOTENCY_*`, `UNDO_*`, etc.) | C | Error code assertions | partial |
| API-6 | §6 | Payload limits (text 10k, URL 2k); metadata-only screenshot body | U/C | Validation + boundary tests | partial |

---

## B) Endpoints (`api-contract` §3)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| API-3.1 | §3.1 | `POST /v1/captures` — text/link/screenshot shapes; 201 + draft entry | C | `backend/test/captures.test.ts` | partial |
| API-3.1-V | §3.1 | Validation: type required; text min 1; link http(s); screenshot `storage_path` | C | `backend/test/captures.test.ts` | partial |
| API-3.2 | §3.2 | `POST /v1/captures/:id/suggestions` — ranked options, confidence, `reason_short` | C/U | `backend/test/suggestions*.test.ts` (planned) | planned |
| API-3.2-CS | §3.2 cold-start | Zero collections → `source=cold_start`, `create_new` top, 1–3 names | C | Suggestion cold-start tests | planned |
| API-3.2-FB | §3.2 fallback | Model fail → `fallback`, recent + create_new, `uncertain` | C/U | Suggestion fallback tests | planned |
| API-3.3 | §3.3 | `POST .../confirm` — idempotency; existing vs create_new; 200 payload | C/I | `backend/test/placement-confirm*.test.ts` (planned) | planned |
| API-3.4 | §3.4 | `POST /v1/entries/:id/move` — idempotency; collection vs create_new | C/I | `backend/test/move*.test.ts` (planned) | planned |
| API-3.5 | §3.5 | `POST .../undo` — idempotency; not latest → 409; window expired; replay same key | C/I | `backend/test/undo*.test.ts` (planned) | planned |
| API-3.6 | §3.6 | `GET /v1/feed` — cursor, ranked items, previews | C | `backend/test/feed*.test.ts` (planned) | planned |
| API-3.7 | §3.7 | `GET /v1/collections/:id/entries` — pagination, shape | C | `backend/test/collection-entries*.test.ts` (planned) | planned |
| API-3.8 | §3.8 | `POST /v1/events` — 202, accepted/rejected counts | C | `backend/test/events*.test.ts` (planned) | planned |

---

## C) System design — backend modules (`system-design` §3)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| SYS-3.1-AUTH | §3.1 `auth` | JWT validation; user identity for all handlers | C | Auth middleware tests + 401 matrix | partial |
| SYS-3.1-CAP | §3.1 `capture` | Draft entry creation text/link/screenshot | C | `backend/test/captures.test.ts` | partial |
| SYS-3.1-SUG | §3.1 `suggestion` | Candidates + OpenAI + structured validation | U/C/I | Mock provider + contract tests | planned |
| SYS-3.1-PLC | §3.1 `placement` | Confirm, create-new path, action log | C/I | Placement integration tests | planned |
| SYS-3.1-REC | §3.1 `recovery` | Undo + move; invariants | C/I | Undo/move tests | planned |
| SYS-3.1-FED | §3.1 `feed` | Ranking per `rank_v1` | U/C | Feed ranking unit + API tests | planned |
| SYS-3.1-LOG | §3.1 `logging` | Events persisted; operational logs | C/I | Events endpoint + DB assertions | planned |

---

## D) Data model and tenancy (`system-design` §4, §8)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| SYS-4.1 | §4.1–4.2 | Entry user ownership; `collection_id` null only pre-confirm | I | DB/integration tests (with migration spec) | planned |
| SYS-4.2 | §4.2 | `confidence_label` enum enforcement | U | Label derivation tests | planned |
| SYS-8.1 | §8.1 | JWT middleware; row scope by `user_id` | I | RLS + API cross-user tests | planned |
| SYS-8.2 | §8.2 | Min PII in prompts; SSRF-safe link fetch if implemented | U/Sec | Red-team / allowlist tests | planned |
| SYS-8.3 | §8.3 | Idempotency + retry policy for transient AI failures | C/U | Idempotency + retry unit tests | planned |
| SYS-8.4 | §8.4 | Undo: latest action only; 5m window; idempotent terminal replay | C/I | `backend/test/undo*.test.ts` | planned |

---

## E) AI, confidence, cold-start (`system-design` §5–§6, §10)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| SYS-5.2 | §5.2 | Structured JSON from model (top_choice, alternatives, score, reason) | U | Parser/schema tests | planned |
| SYS-5.3 | §5.3 | `confidence_label` from `confidence_policy_v1` thresholds | U | `confidence-policy.test.ts` (planned) | planned |
| SYS-5.4 | §5.4 | Fallback non-blocking; `source=fallback` | C | Suggestion API tests | planned |
| SYS-6 | §6 | Screenshot path: limits, timeout, sync+async policy | C/N | Latency budget + fallback tests | planned |
| SYS-10 | §10 | Cold-start: CREATE_NEW, 1–3 suggested names | C | API + suggestion unit tests | planned |

---

## F) Feed ranking (`system-design` §7)

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| SYS-7.1 | §7.1.1 | `rank_v1` formula + tie-breakers | U | `rank-v1.test.ts` (planned) | planned |
| SYS-7.2 | §7.2 | Bumped collections surface on home | C/E | Feed API + UI smoke | planned |

---

## G) Frontend / mobile stream (contract + design alignment)

Mapped to **planned** mobile tests until an app package exists. See `frontend/__tests__/README-TEST-PLAN.md`.

| Req ID | Source | Requirement (summary) | Test type | Artifact | Status |
|--------|--------|------------------------|-----------|----------|--------|
| FE-API | Contract | Typed client covers all v1 endpoints | U | API client unit tests | planned |
| FE-FLOW-1 | Design §2.1 | Capture → review → confirm | E | Detox/Maestro/Playwright (stack TBD) | planned |
| FE-FLOW-2 | Design §2.1 | Undo and move with consistent review UI | E | E2E flows | planned |
| FE-UI-CS | API §3.2 | `cold_start` / `fallback` as normal UI states | E/Component | Review sheet state tests | planned |
| FE-A11Y | PRD/UI | Key controls accessible | E/Lint | a11y checklist in gate doc | planned |
| FE-OFF | Design §11.4 | Offline-safe draft queue (MVP best-effort) | E/I | Queue behavior tests | planned |

---

## Maintenance
- When adding a test file, update the **Artifact** and **Status** columns in this matrix in the same PR.
- Gate ownership: see `docs/handoff/TDD-TEST-GATES-CHECKLIST.md`.
