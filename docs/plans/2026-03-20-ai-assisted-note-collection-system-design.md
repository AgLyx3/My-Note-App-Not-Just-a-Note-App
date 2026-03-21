# System Design Spec: AI-Assisted Note Collection (MVP)

## Document Control
- Date: 2026-03-20
- Product: AI-assisted note collection app
- Platform: iOS + Android
- Source references:
  - `docs/plans/2026-03-20-ai-assisted-note-collection-prd.md`
  - `docs/plans/2026-03-20-ai-assisted-note-collection-mobile-ui-design.md`
- Architecture decision: Supabase (Auth/DB/Storage) + Node API

## 1) Architecture Summary

### 1.1 Chosen Stack
- Mobile app: React Native (or native iOS/Android) with shared API contract
- Backend API: Node.js + TypeScript (single deployable service)
- Auth: Supabase Auth
- Database: Supabase Postgres
- File storage: Supabase Storage (screenshots)
- AI provider: OpenAI (multimodal for image understanding and text routing with URL enrichment)
- Logging/analytics: custom in-house event logging tables and backend logs

### 1.2 Why this architecture
- Keeps infra cost and ops burden low for pre-MVP
- Preserves server-side control of AI prompting, confidence logic, and retries
- Avoids exposing OpenAI keys in client
- Keeps core domain logic centralized and testable
- Allows future extraction of jobs/services without rewriting app contracts

## 2) System Context

### 2.1 Primary user flow
1. User captures text or image
2. App uploads payload and creates draft `Entry`
3. Node API requests placement suggestions from OpenAI
4. App shows quick review sheet (suggested + alternatives + create new)
5. User confirms or creates new collection
6. Backend commits placement and bumps collection feed ranking
7. App shows Undo option

### 2.2 High-level components
- `Mobile Client`
  - Home feed, capture, review sheet, collection detail
- `Node API`
  - Auth guard, capture orchestration, suggestion generation, placement/undo/move, feed ranking
- `Supabase`
  - Auth users, Postgres records, screenshot object storage
- `OpenAI`
  - Categorization and confidence scoring (text, links, screenshots)

## 3) Backend Service Design (Node API)

### 3.1 Internal modules
- `auth`
  - Validates Supabase JWT and resolves user identity
- `capture`
  - Handles draft entry creation for text/image
- `suggestion`
  - Builds candidate collections, calls OpenAI, validates structured result
- `placement`
  - Confirms suggestion, handles create-new collection path, logs action
- `recovery`
  - Undo last placement and move entry across collections
- `feed`
  - Computes active collection feed ranking
- `logging`
  - Writes product events and operational logs

### 3.2 API endpoints (v1)
- `POST /v1/captures`
  - Input: capture type + payload metadata
  - Output: draft entry ID
- `POST /v1/captures/:entryId/suggestions`
  - Input: optional context hints
  - Output: ranked options, confidence label, confidence score
- `POST /v1/captures/:entryId/confirm`
  - Input: selected collection ID OR new collection name
  - Output: confirmed placement payload + updated collection summary
- `POST /v1/entries/:entryId/move`
  - Input: target collection ID or new collection name
  - Output: moved entry payload
- `POST /v1/placements/:placementId/undo`
  - Input: none
  - Output: reverted placement status
- `GET /v1/feed`
  - Output: ranked active collections for home
- `GET /v1/collections/:collectionId/entries`
  - Output: entries list for collection detail
- `POST /v1/events`
  - Input: client events for KPI tracking
  - Output: accepted/ignored status

## 4) Data Model (Supabase Postgres)

### 4.1 Tables
- `profiles` (1:1 extension of `auth.users`)
  - `id` (FK to `auth.users.id`), `created_at`, `settings_json`
- `collections`
  - `id`, `user_id`, `name`, `description`, `created_at`, `updated_at`, `last_activity_at`, `is_archived`
- `entries`
  - `id`, `user_id`, `collection_id (nullable during draft)`, `type (text|image)`, `content_raw`, `content_normalized`, `image_path`, `created_at`, `updated_at`
- `placement_suggestions`
  - `id`, `entry_id`, `user_id`, `top_choice_collection_id (nullable)`, `alternatives_json`, `confidence_score`, `confidence_label`, `reason_short`, `model_name`, `model_version`, `created_at`
- `placement_actions`
  - `id`, `entry_id`, `user_id`, `action_type (confirm|move|undo|create_new)`, `from_collection_id`, `to_collection_id`, `created_at`
- `event_logs`
  - `id`, `user_id`, `event_name`, `event_payload_json`, `created_at`

### 4.2 Data constraints
- Every `entry` belongs to one `user`
- `collection_id` can be null only before confirmation
- `confidence_label` must be one of: `likely`, `possible`, `uncertain`
- All collection operations are tenant-scoped by `user_id`

## 5) AI Categorization Design (OpenAI)

### 5.1 Inputs to model
- Capture payload:
  - Text note content (may include URLs for crawl/enrichment) OR image + optional extracted context
- Candidate collection list:
  - Recent collections
  - Frequently used collections
  - Semantic candidates from collection summaries/history
- Recent correction signals:
  - prior move/undo patterns for same user

### 5.2 Structured output contract
The model must return strict JSON:
- `top_choice`: existing collection ID or `CREATE_NEW`
- `alternatives`: up to 4 collection IDs (or include `CREATE_NEW`)
- `confidence_score`: float 0.0-1.0
- `reason_short`: short text rationale for debugging

### 5.3 Confidence behavior mapping
- Server computes `confidence_label` from calibrated thresholds, not directly from model text.
- Calibration policy (`confidence_policy_v1`):
  - `likely`: score >= 0.75 and top-1 minus top-2 score gap >= 0.15
  - `possible`: score 0.45-0.74 or small gap (>= 0.05 and < 0.15)
  - `uncertain`: score < 0.45 or gap < 0.05
- UI mapping:
  - `likely`: preselect top suggestion
  - `possible`: preselect top suggestion, keep create-new equally prominent
  - `uncertain`: preselect or highlight create-new by default

### 5.4 Fallback behavior
- If OpenAI call fails/timeouts:
  - show recent collections + create-new
  - mark suggestion source as fallback
  - allow user to continue without blocking capture flow

## 6) Image Processing Strategy (LLM-first)

- Use OpenAI multimodal endpoint directly on image input
- Resize/compress image client-side before upload to control latency and cost
- Store original in Supabase Storage and pass signed URL or fetched bytes to backend
- Enforce limits:
  - max file size
  - timeout budget
  - retry ceiling
- If image understanding confidence is low, bias decision UI toward create-new

### 6.1 Sync + async fallback policy
- Primary path: synchronous suggestion request with strict timebox (for example, 2.0s backend budget).
- If timebox exceeded or transient model error:
  - return fallback suggestions immediately (recent collections + create-new),
  - enqueue async reclassification job,
  - optionally refresh review options in place if async result arrives before user confirms.
- This prevents capture flow blocking while still allowing better suggestions when available.

## 7) Feed Ranking Design

### 7.1 Ranking signals
- `last_activity_at` (strong recency signal)
- recent confirmed placements
- recent direct user interactions with a collection
- optional unresolved fresh-entry weight

### 7.1.1 Ranking formula (rank_v1)
- `rank_score = (0.50 * recency_score) + (0.25 * placement_score_24h) + (0.20 * interaction_score_24h) + (0.05 * fresh_unresolved_score)`
- Recency uses exponential decay by hours since last activity.
- Tie-breakers (in order): `last_activity_at` desc, `updated_at` desc, `id` asc.
- Store computed rank metadata with version tag `rank_v1` to support future tuning.

### 7.2 Result behavior
- Recently updated collections should "bump" to top
- Search remains secondary to visible active context on home

## 8) Security, Privacy, and Reliability

### 8.1 Security baseline
- Supabase JWT validation in Node API middleware
- User-level row scope on every query
- OpenAI key stored server-side only
- Signed URLs for image upload/download

### 8.2 Privacy baseline
- Avoid sending unnecessary PII in model prompts
- Store minimum required event payloads
- Support user data delete/export paths in schema design
- If link preview resolution is server-side, restrict fetcher to allowlisted schemes and private-network protected rules to avoid SSRF risks.

### 8.3 Reliability baseline
- Idempotency keys for confirm/move actions
- Undo window support using `placement_actions`
- Retry policy for transient OpenAI failures

### 8.4 Undo invariants
- Undo is only valid for the latest reversible action on an entry for that user.
- Default undo window: 5 minutes after action creation.
- Undo is rejected if a newer confirm/move action exists for the same entry.
- Undo operations are idempotent; repeated requests return the same terminal state.

## 9) Performance Targets (MVP)

- Capture submit -> suggestion response: p95 <= 1.5s for typical text (including URL-enrichment path where available)
- Image suggestion response (sync path): p95 <= 3.5s for typical mobile-sized images
- If sync path exceeds budget, system must return fallback options without blocking capture completion.
- Confirm placement -> updated feed visible: p95 <= 500ms

## 10) Collection Bootstrap Strategy

- Start with zero collections for new users
- Cold-start placement mode (no collections yet):
  - force `top_choice = CREATE_NEW`,
  - infer 1-3 suggested collection names from the first captures,
  - do not require selecting from nonexistent collections.
- First dropped notes trigger inferred suggestions and create-new recommendations
- User can always rename/edit collection manually
- No forced taxonomy setup before first capture

## 11) Implementation Handoff Tasks

### 11.1 Backend (Node API)
- Create TypeScript API skeleton and module boundaries
- Implement auth middleware using Supabase JWT
- Implement capture, suggestion, confirm, move, undo, feed endpoints
- Add OpenAI client with structured-output validation and fallback
- Add logging/event endpoint and structured operational logs

### 11.2 Database (Supabase Postgres)
- Create tables and indexes for collections, entries, suggestions, actions, events
- Add row-level security policies by `user_id`
- Add migration scripts and seed/dev fixtures
- Partition or retention policy for `event_logs` to control growth and cost

### 11.3 Storage
- Create image bucket and signed upload flow
- Add retention/cleanup strategy for abandoned draft assets
- Define signed URL TTL defaults and access policy boundaries

### 11.4 Mobile client integration
- Build typed API client for all v1 endpoints
- Implement capture -> review -> confirm flow with optimistic updates
- Implement undo and move with consistent review sheet UI
- Implement offline-safe draft queue (best-effort MVP)

## 12) Required Secrets and Configuration

Before implementation starts, provide:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (client)
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `OPENAI_API_KEY`
- App env split: `dev`, `staging`, `prod` (or `dev` + `prod` at minimum)

## 13) Open Decisions (optional, can defer)

- Mobile framework final choice: React Native vs native
- Node framework final choice: Fastify vs Express
- Whether to add pgvector now or later for semantic candidate retrieval
- Whether image processing should be sync in request path or async job for larger files

## 14) Recommended immediate next step

Use this document as the implementation baseline, then produce:
1. API contract spec (request/response examples)
2. DB migration plan
3. Backend task list and frontend task list (parallelized)
