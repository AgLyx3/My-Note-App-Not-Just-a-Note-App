# Notes App Workspace

This workspace is organized for product discovery and planning.

## Structure
- `docs/plans/`: PRDs, discovery outputs, Lean UX artifacts.
- `.cursor/skills/`: local skill library used by the assistant.

### Apps & services
| Path | Role |
|------|------|
| `backend/` | Fastify API (`src/`), Vitest tests (`test/`), `npm run dev` / `build` / `typecheck`. Output: `dist/` (gitignored). Secrets: **`backend/.env`** (not committed); template **`backend/.env.example`**. |
| `mobile-app/` | Expo / React Native app (`app/`, `src/`). Env: **`mobile-app/.env`** (gitignored); template **`mobile-app/.env.example`**. Use only `EXPO_PUBLIC_*` for non-secret config; API keys belong on the server. |
| `frontend/` | Web frontend (if used in your flow); has its own `package.json` and `tsconfig.json`. |

Root `package.json` is a lightweight workspace placeholder (no workspaces field); run **`npm install`** inside each app directory you use.

## Start Here
- Current PRD: `docs/plans/2026-03-20-ai-assisted-note-collection-prd.md`
- Skill inventory: `.cursor/skills/INVENTORY.md`
