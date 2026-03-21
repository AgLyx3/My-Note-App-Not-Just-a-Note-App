# DB Migration Spec: AI Note Collection v1 (Supabase Postgres)

## Document Control
- Date: 2026-03-20
- Scope: MVP schema, indexes, constraints, and RLS policy design
- Related docs:
  - `docs/plans/2026-03-20-ai-assisted-note-collection-system-design.md`
  - `docs/api/2026-03-20-ai-note-v1-api-contract.md`

## 1) Migration strategy

- Use incremental SQL migrations in this order:
  1. extensions and enums
  2. tables
  3. constraints and indexes
  4. triggers/functions
  5. RLS policies
  6. optional seed fixtures for local/dev
- Naming convention:
  - tables: snake_case plural
  - primary keys: `id`
  - foreign keys: `<table>_id`
  - timestamps: `created_at`, `updated_at`

## 2) Required extensions and enums

### 2.1 Extensions
- `pgcrypto` for UUID generation (if needed)
- `citext` optional for case-insensitive collection names

### 2.2 Enums
- `entry_type`: `text`, `link`, `screenshot`
- `confidence_label`: `likely`, `possible`, `uncertain`
- `suggestion_source`: `model`, `fallback`, `cold_start`
- `placement_action_type`: `confirm`, `move`, `undo`, `create_new`

## 3) Table definitions

## 3.1 `profiles`
1:1 extension of Supabase `auth.users`.

Columns:
- `id uuid primary key references auth.users(id) on delete cascade`
- `settings_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

## 3.2 `collections`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `description text null`
- `is_archived boolean not null default false`
- `last_activity_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- `check (char_length(trim(name)) between 1 and 120)`
- unique per user on active name:
  - `unique (user_id, lower(name), is_archived)` (or use partial unique index where `is_archived=false`)

## 3.3 `entries`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `collection_id uuid null references collections(id) on delete set null`
- `type entry_type not null`
- `content_raw text null`
- `content_normalized text null`
- `link_url text null`
- `screenshot_path text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- type-specific content checks:
  - for `text`: `content_raw` required
  - for `link`: `link_url` required
  - for `screenshot`: `screenshot_path` required
- URL length guard for link type (<= 2048 chars)

## 3.4 `placement_suggestions`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `entry_id uuid not null references entries(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `source suggestion_source not null`
- `top_choice_collection_id uuid null references collections(id) on delete set null`
- `alternatives_json jsonb not null default '[]'::jsonb`
- `confidence_score numeric(4,3) not null check (confidence_score >= 0 and confidence_score <= 1)`
- `confidence_label confidence_label not null`
- `policy_version text not null default 'confidence_policy_v1'`
- `reason_short text null`
- `model_name text null`
- `model_version text null`
- `created_at timestamptz not null default now()`

## 3.5 `placement_actions`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `entry_id uuid not null references entries(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `action_type placement_action_type not null`
- `from_collection_id uuid null references collections(id) on delete set null`
- `to_collection_id uuid null references collections(id) on delete set null`
- `reverted_placement_id uuid null references placement_actions(id) on delete set null`
- `idempotency_key text null`
- `undo_expires_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints:
- `idempotency_key` uniqueness scoped by user + route group (implemented via composite index)

## 3.6 `event_logs`

Columns:
- `id bigint generated always as identity primary key`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `event_name text not null`
- `event_payload_json jsonb not null default '{}'::jsonb`
- `occurred_at timestamptz not null`
- `created_at timestamptz not null default now()`

Retention:
- keep hot data in primary table for 30-90 days
- archive/delete older data with scheduled job

## 3.7 `idempotency_keys` (recommended)
Dedicated table simplifies replay correctness.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `route_key text not null`
- `idempotency_key text not null`
- `request_hash text not null`
- `response_json jsonb not null`
- `status_code int not null`
- `created_at timestamptz not null default now()`

Constraint:
- unique (`user_id`, `route_key`, `idempotency_key`)

## 4) Index plan

Create these indexes early:

- `collections(user_id, is_archived, last_activity_at desc)`
- `collections(user_id, updated_at desc)`
- `entries(user_id, created_at desc)`
- `entries(collection_id, created_at desc) where collection_id is not null`
- `entries(user_id, type, created_at desc)`
- `placement_suggestions(entry_id, created_at desc)`
- `placement_suggestions(user_id, created_at desc)`
- `placement_actions(entry_id, created_at desc)`
- `placement_actions(user_id, created_at desc)`
- `event_logs(user_id, occurred_at desc)`
- optional GIN for event payload diagnostics:
  - `gin(event_payload_json jsonb_path_ops)`

## 5) Trigger/function plan

### 5.1 `set_updated_at` trigger
Apply to:
- `profiles`
- `collections`
- `entries`

Behavior:
- on update, set `updated_at = now()`

### 5.2 collection activity bump
On placement confirm/move:
- update target collection `last_activity_at = now()`
- update source collection activity if needed (optional for MVP)

### 5.3 profile bootstrap trigger
On `auth.users` insert:
- create corresponding `profiles` row

## 6) RLS policy plan

Enable RLS on all app tables:
- `profiles`
- `collections`
- `entries`
- `placement_suggestions`
- `placement_actions`
- `event_logs`
- `idempotency_keys`

Base policy pattern:
- allow only rows where `user_id = auth.uid()`
- for `profiles`, row `id = auth.uid()`

### 6.1 Example policy matrix
- `SELECT`: own rows only
- `INSERT`: `user_id` (or `id`) must equal `auth.uid()`
- `UPDATE`: own rows only
- `DELETE`: own rows only

Server-side Node API using service role key:
- bypasses RLS by default; enforce tenant checks in application logic
- optionally force RLS mode for selected query paths if desired

## 7) SQL skeleton (starter)

```sql
-- 001_extensions_enums.sql
create extension if not exists pgcrypto;

do $$ begin
  create type entry_type as enum ('text', 'link', 'screenshot');
exception when duplicate_object then null; end $$;

do $$ begin
  create type confidence_label as enum ('likely', 'possible', 'uncertain');
exception when duplicate_object then null; end $$;

do $$ begin
  create type suggestion_source as enum ('model', 'fallback', 'cold_start');
exception when duplicate_object then null; end $$;

do $$ begin
  create type placement_action_type as enum ('confirm', 'move', 'undo', 'create_new');
exception when duplicate_object then null; end $$;
```

```sql
-- 002_tables.sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_archived boolean not null default false,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_name_len_chk check (char_length(trim(name)) between 1 and 120)
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid references collections(id) on delete set null,
  type entry_type not null,
  content_raw text,
  content_normalized text,
  link_url text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_link_len_chk check (link_url is null or char_length(link_url) <= 2048),
  constraint entries_type_payload_chk check (
    (type = 'text' and content_raw is not null and char_length(trim(content_raw)) > 0)
    or (type = 'link' and link_url is not null and char_length(trim(link_url)) > 0)
    or (type = 'screenshot' and screenshot_path is not null and char_length(trim(screenshot_path)) > 0)
  )
);
```

```sql
-- 003_rls.sql
alter table profiles enable row level security;
alter table collections enable row level security;
alter table entries enable row level security;

create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own on profiles
  for update using (id = auth.uid());

create policy collections_select_own on collections
  for select using (user_id = auth.uid());

create policy collections_insert_own on collections
  for insert with check (user_id = auth.uid());

create policy collections_update_own on collections
  for update using (user_id = auth.uid());

create policy entries_select_own on entries
  for select using (user_id = auth.uid());

create policy entries_insert_own on entries
  for insert with check (user_id = auth.uid());

create policy entries_update_own on entries
  for update using (user_id = auth.uid());
```

## 8) Data lifecycle and maintenance

- `event_logs`: periodic archive/delete job (daily)
- orphan screenshot cleanup:
  - remove objects for stale draft entries beyond TTL (for example 7 days)
- index maintenance:
  - monitor bloat and query plans monthly during MVP

## 9) Migration acceptance checklist

- [ ] All tables created in clean database
- [ ] All FK and check constraints pass basic tests
- [ ] RLS blocks cross-user access in client role tests
- [ ] Core query paths use intended indexes (`EXPLAIN`)
- [ ] Idempotency replay behavior covered with integration tests
- [ ] Undo invariant behavior verified at DB + API layers

