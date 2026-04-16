#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_ROOT"

echo "[1/4] install deps"
npm install

echo "[2/4] build frontend and backend"
npm run build

echo "[3/4] copy frontend dist to /opt/management-system (customize as needed)"
# rsync -av --delete apps/frontend/dist/ /opt/management-system/apps/frontend/dist/
# rsync -av apps/backend/ /opt/management-system/apps/backend/

echo "[4/4] restart backend service"
# sudo systemctl restart management-backend

echo "done"
