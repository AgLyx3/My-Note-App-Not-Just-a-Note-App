# Ops Dashboard

Deployable metrics dashboard for the Notes App ranking flow.

## Local run

1. Start backend on `3001`:
   - `npm run dev:backend`
2. Start dashboard:
   - `npm run dev:ops-dashboard`
3. Open the shown Vite URL (default `http://localhost:5175`).

## What it shows

- Capture volume
- Suggestion request/success counts
- Placement confirmations
- Suggestion success rate
- Fallback rate
- P95 suggestion latency
- Average confidence score
- Top suggestion kind distribution
- Recent raw telemetry events

## API contract

The dashboard reads:

- `GET /v1/metrics/summary?hours=24`
- `GET /v1/metrics/events?hours=24&limit=100`
- `GET /v1/metrics/production-traces?hours=24&limit=100`

If `DASHBOARD_TOKEN` is set in backend env, pass it in `x-dashboard-token`.

## Render deployment

Deploy this folder as a static site:

- Build command: `npm run build --workspace ops-dashboard`
- Publish directory: `ops-dashboard/dist`
- Backend URL should be same-origin through reverse proxy, or configure your static host to proxy `/v1` to backend.

