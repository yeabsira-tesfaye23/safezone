#!/usr/bin/env sh
# Starts SafeZone (macOS / Linux). Needs Node.js 20+.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
[ -d backend/node_modules ] || npm --prefix backend install --omit=dev || exit 1
[ -f frontend/dist/index.html ] || { npm --prefix frontend install && npm --prefix frontend run build; } || exit 1
echo "SafeZone will be at http://localhost:4000"
cd backend && exec node src/server.js