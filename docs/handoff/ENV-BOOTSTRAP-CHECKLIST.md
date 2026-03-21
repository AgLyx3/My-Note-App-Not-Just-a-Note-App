# Environment Bootstrap Checklist

## Goal
Run this once so implementation can proceed without permission interruptions.

## 1) Permission model to pre-approve

- `full_network`
  - Needed for package installs and external API access
  - Examples: `npm install`, OpenAI/Supabase API checks, pulling container images
- `all`
  - Needed for protected local path operations in this environment
  - Examples: writes to `.cursor/*`, some hidden/IDE-managed paths, unrestricted local access

Recommended: allow both when prompted during setup and implementation.

## 2) Tool install checks

Already present:
- Node, npm, Python, git, docker, psql

Missing:
- Supabase CLI

## 3) Install Supabase CLI (macOS)

```bash
brew install supabase/tap/supabase
supabase --version
```

If Homebrew tap fails:

```bash
brew install supabase
supabase --version
```

## 4) Project bootstrap commands (when code scaffold starts)

Backend:

```bash
cd backend
npm install
npm run lint
npm run test
```

Frontend:

```bash
cd frontend
npm install
npm run lint
npm run test
```

## 5) Supabase local/dev workflow commands

```bash
supabase login
supabase init
supabase start
supabase db reset
supabase status
```

If using remote project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## 6) Environment variables to prepare

Server:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Client:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## 7) Quick verification checklist

- `supabase --version` works
- `npm install` works in backend/frontend
- test commands run without missing binary errors
- env vars are loaded in local run
- DB migration command succeeds at least once

## 8) If you want zero pauses during execution

When prompts appear, approve:
- `required_permissions: ["full_network"]`
- `required_permissions: ["all"]`

This is sufficient for end-to-end scaffold, install, migration, test, and iterative implementation.

