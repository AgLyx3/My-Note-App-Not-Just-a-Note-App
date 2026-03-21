# API Contract: AI Note Collection v1

## Document Control
- Date: 2026-03-20
- Scope: MVP API contract for mobile client and Node backend
- Related design docs:
  - `docs/plans/2026-03-20-ai-assisted-note-collection-prd.md`
  - `docs/plans/2026-03-20-ai-assisted-note-collection-mobile-ui-design.md`
  - `docs/plans/2026-03-20-ai-assisted-note-collection-system-design.md`

## 1) Conventions

### 1.1 Base URL and versioning
- Base URL: `/v1`
- All endpoints are user-scoped via auth context

### 1.2 Authentication
- Header: `Authorization: Bearer <supabase_access_token>`
- Server validates Supabase JWT and derives `user_id`

### 1.3 Content type
- Request/response: `application/json`

### 1.4 Time format
- ISO 8601 UTC timestamps (example: `2026-03-20T09:15:00Z`)

### 1.5 Idempotency
- Required for mutation endpoints that can be retried:
  - `POST /captures/:entryId/confirm`
  - `POST /entries/:entryId/move`
  - `POST /placements/:placementId/undo`
- Header: `Idempotency-Key: <uuid>`

### 1.6 Standard error envelope
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": {
      "field": "type",
      "reason": "must be one of text|image"
    },
    "request_id": "req_123"
  }
}
```

## 2) Enums and shared types

### 2.1 Enums
- `EntryType`: `text | image`
- `ConfidenceLabel`: `likely | possible | uncertain`
- `SuggestionSource`: `model | fallback | cold_start`
- `PlacementActionType`: `confirm | move | undo | create_new`

### 2.2 Shared object: CollectionSummary
```json
{
  "id": "col_123",
  "name": "Trip Planning",
  "last_activity_at": "2026-03-20T09:15:00Z"
}
```

### 2.3 Shared object: SuggestionOption
```json
{
  "kind": "collection",
  "collection": {
    "id": "col_123",
    "name": "Trip Planning",
    "last_activity_at": "2026-03-20T09:15:00Z"
  },
  "rank": 1,
  "score": 0.88
}
```

`kind` can be:
- `collection`
- `create_new`

## 3) Endpoint contracts

## 3.1 Create Capture
`POST /v1/captures`

Creates a draft entry before placement decision.

### Request
```json
{
  "type": "text",
  "content": {
    "text": "Need to book flights for Tokyo in April"
  },
  "client_context": {
    "device_time": "2026-03-20T09:14:55Z",
    "timezone": "Asia/Tokyo"
  }
}
```

For `type=image`:
```json
{
  "type": "image",
  "content": {
    "storage_path": "media/user_1/abc.png"
  }
}
```

### Validation rules
- `type` required
- `text` required when `type=text`, min length 1
- `storage_path` required when `type=image`
- URLs are accepted inside `content.text`; backend detects URLs and may crawl them for richer classification context

### Response `201`
```json
{
  "entry": {
    "id": "ent_123",
    "type": "text",
    "status": "draft",
    "created_at": "2026-03-20T09:15:00Z"
  }
}
```

## 3.2 Get Placement Suggestions
`POST /v1/captures/:entryId/suggestions`

Generates ranked placement options and confidence for review sheet.

### Request
```json
{
  "hints": {
    "recent_collection_ids": ["col_1", "col_2"]
  }
}
```

### Response `200`
```json
{
  "entry_id": "ent_123",
  "source": "model",
  "confidence": {
    "score": 0.82,
    "label": "likely",
    "policy_version": "confidence_policy_v1"
  },
  "top_option": {
    "kind": "collection",
    "collection": {
      "id": "col_1",
      "name": "Travel",
      "last_activity_at": "2026-03-20T09:10:00Z"
    },
    "rank": 1,
    "score": 0.82
  },
  "alternatives": [
    {
      "kind": "collection",
      "collection": {
        "id": "col_2",
        "name": "Personal Admin",
        "last_activity_at": "2026-03-19T18:30:00Z"
      },
      "rank": 2,
      "score": 0.55
    },
    {
      "kind": "create_new",
      "rank": 3,
      "score": 0.48,
      "suggested_name": "Tokyo Trip"
    }
  ],
  "reason_short": "Mentions flights and destination planning.",
  "generated_at": "2026-03-20T09:15:01Z"
}
```

### Cold-start response behavior
If user has zero collections:
- `source` is `cold_start`
- `top_option.kind` is `create_new`
- include 1-3 `suggested_name` options in alternatives

### Fallback response behavior
If model times out/fails:
- `source` is `fallback`
- return recent collections + `create_new`
- include `confidence.label=uncertain`

## 3.3 Confirm Placement
`POST /v1/captures/:entryId/confirm`

Finalizes entry placement to existing or new collection.

### Headers
- `Idempotency-Key` required

### Request (existing collection)
```json
{
  "selection": {
    "kind": "collection",
    "collection_id": "col_1"
  }
}
```

### Request (create new)
```json
{
  "selection": {
    "kind": "create_new",
    "new_collection_name": "Tokyo Trip"
  }
}
```

### Response `200`
```json
{
  "placement": {
    "id": "plc_123",
    "entry_id": "ent_123",
    "action_type": "confirm",
    "to_collection_id": "col_1",
    "created_at": "2026-03-20T09:15:03Z",
    "undo_expires_at": "2026-03-20T09:20:03Z"
  },
  "entry": {
    "id": "ent_123",
    "collection_id": "col_1",
    "status": "placed",
    "updated_at": "2026-03-20T09:15:03Z"
  },
  "collection": {
    "id": "col_1",
    "name": "Travel",
    "last_activity_at": "2026-03-20T09:15:03Z"
  }
}
```

## 3.4 Move Entry
`POST /v1/entries/:entryId/move`

Moves an already placed entry to another collection.

### Headers
- `Idempotency-Key` required

### Request
```json
{
  "target": {
    "kind": "collection",
    "collection_id": "col_9"
  }
}
```

or

```json
{
  "target": {
    "kind": "create_new",
    "new_collection_name": "Design Ideas"
  }
}
```

### Response `200`
```json
{
  "placement": {
    "id": "plc_222",
    "entry_id": "ent_123",
    "action_type": "move",
    "from_collection_id": "col_1",
    "to_collection_id": "col_9",
    "created_at": "2026-03-20T09:20:00Z",
    "undo_expires_at": "2026-03-20T09:25:00Z"
  },
  "entry": {
    "id": "ent_123",
    "collection_id": "col_9",
    "updated_at": "2026-03-20T09:20:00Z"
  }
}
```

## 3.5 Undo Placement
`POST /v1/placements/:placementId/undo`

Reverts latest reversible placement action only.

### Headers
- `Idempotency-Key` required

### Request
```json
{}
```

### Response `200`
```json
{
  "placement": {
    "id": "plc_123",
    "action_type": "undo",
    "reverted_placement_id": "plc_120",
    "created_at": "2026-03-20T09:16:00Z"
  },
  "entry": {
    "id": "ent_123",
    "collection_id": "col_prev",
    "updated_at": "2026-03-20T09:16:00Z"
  }
}
```

### Undo guardrails
- Reject if target placement is not latest reversible action for entry
- Reject if undo window expired
- Repeat same idempotency key returns identical terminal response

## 3.6 Get Home Feed
`GET /v1/feed?limit=20&cursor=<token>`

Returns ranked active collections for home screen.

### Response `200`
```json
{
  "items": [
    {
      "collection": {
        "id": "col_1",
        "name": "Travel",
        "last_activity_at": "2026-03-20T09:15:03Z"
      },
      "rank": {
        "score": 0.91,
        "version": "rank_v1"
      },
      "preview_entries": [
        {
          "entry_id": "ent_123",
          "type": "text",
          "preview_text": "Need to book flights..."
        }
      ]
    }
  ],
  "next_cursor": "cur_abc"
}
```

## 3.7 Get Collection Entries
`GET /v1/collections/:collectionId/entries?limit=30&cursor=<token>`

### Response `200`
```json
{
  "collection": {
    "id": "col_1",
    "name": "Travel"
  },
  "items": [
    {
      "id": "ent_123",
      "type": "text",
      "content_preview": "Need to book flights...",
      "created_at": "2026-03-20T09:15:00Z"
    }
  ],
  "next_cursor": null
}
```

## 3.8 Log Client Event
`POST /v1/events`

### Request
```json
{
  "events": [
    {
      "name": "review_sheet_shown",
      "occurred_at": "2026-03-20T09:15:01Z",
      "payload": {
        "entry_id": "ent_123",
        "confidence_label": "likely",
        "source": "model"
      }
    },
    {
      "name": "suggestion_accepted",
      "occurred_at": "2026-03-20T09:15:03Z",
      "payload": {
        "entry_id": "ent_123",
        "selected_kind": "collection"
      }
    }
  ]
}
```

### Response `202`
```json
{
  "accepted": 2,
  "rejected": 0
}
```

## 4) Status codes

- `200 OK`: successful read/mutation
- `201 Created`: successful creation
- `202 Accepted`: async or batch accepted
- `400 Bad Request`: malformed JSON, missing required fields
- `401 Unauthorized`: missing/invalid token
- `403 Forbidden`: resource not owned by user
- `404 Not Found`: resource does not exist
- `409 Conflict`: stale action state (for example undo invariant violation)
- `422 Unprocessable Entity`: semantic validation failure
- `429 Too Many Requests`: rate-limited
- `500 Internal Server Error`: unexpected server error
- `503 Service Unavailable`: upstream provider unavailable

## 5) Error codes (application-level)

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `RESOURCE_NOT_FOUND`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_REPLAY_MISMATCH`
- `UNDO_WINDOW_EXPIRED`
- `UNDO_NOT_LATEST_ACTION`
- `MODEL_TIMEOUT_FALLBACK_USED` (non-fatal informational when returned with success)
- `MODEL_UNAVAILABLE_FALLBACK_USED` (non-fatal informational when returned with success)

## 6) Non-functional API constraints

- Max payload:
  - text length: 10,000 chars (may include URLs)
  - image capture references `storage_path`; binary uploaded separately to storage
- Request timeout targets:
  - text suggestions: 1.5s p95 (including URL-enrichment path where available)
  - image suggestions sync path: 3.5s p95 with fallback guarantee
- Pagination:
  - cursor-based for feed and entry list endpoints

## 7) Suggested implementation notes (backend/frontend parallel work)

- Backend:
  - lock JSON schemas early and generate TS types from schema
  - include `request_id` in all responses for traceability
- Frontend:
  - treat `source=fallback|cold_start` as normal UI state, not error
  - cache latest successful feed page for quick app relaunch

