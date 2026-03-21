#!/usr/bin/env bash
# Manual smoke test against a RUNNING server (default: http://localhost:3001/v1).
# Start backend first: npm run dev
set -euo pipefail
BASE="${API_BASE:-http://localhost:3001/v1}"
TOKEN="${AUTH_TOKEN:-u1}"

echo "=== GET /v1/collections (expect 200) ==="
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE}/collections" | tail -n 3

echo "=== POST /v1/captures text (expect 201) ==="
TMP=$(mktemp)
HTTP=$(curl -sS -o "$TMP" -w "%{http_code}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"text","content":{"text":"smoke test note"}}' \
  "${BASE}/captures")
echo "HTTP $HTTP"
cat "$TMP"
echo ""

ENTRY_ID=$(node -e "const fs=require('fs'); try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(j.entry?.id||'');}catch(e){}" "$TMP" 2>/dev/null || true)
rm -f "$TMP"

if [[ -n "$ENTRY_ID" ]]; then
  echo "=== PATCH /v1/entries/:id (expect 200) ==="
  curl -sS -w "\nHTTP %{http_code}\n" \
    -X PATCH \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"content":{"text":"smoke test note updated"}}' \
    "${BASE}/entries/${ENTRY_ID}" | tail -n 2

  echo "=== DELETE /v1/entries/:id (expect 204) ==="
  curl -sS -w "\nHTTP %{http_code}\n" \
    -X DELETE \
    -H "Authorization: Bearer ${TOKEN}" \
    "${BASE}/entries/${ENTRY_ID}" | tail -n 2
fi

echo "Done. Automated coverage: cd backend && npm test"
