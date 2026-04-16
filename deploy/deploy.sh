#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_ROOT"

PKG_MANAGER="npm"

if command -v pnpm >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/pnpm-workspace.yaml" ]]; then
	PKG_MANAGER="pnpm"
fi

echo "[1/4] install deps"
if [[ "$PKG_MANAGER" == "pnpm" ]]; then
	if [[ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]]; then
		pnpm install --frozen-lockfile
	else
		pnpm install
	fi
else
	if [[ -f "$PROJECT_ROOT/package-lock.json" ]]; then
		npm ci
	else
		npm install
	fi
fi

echo "[2/4] build frontend and backend"
if [[ "$PKG_MANAGER" == "pnpm" ]]; then
	pnpm run build:pnpm
else
	npm run build
fi

echo "[3/4] copy frontend dist to /opt/management-system (customize as needed)"
# rsync -av --delete apps/frontend/dist/ /opt/management-system/apps/frontend/dist/
# rsync -av apps/backend/ /opt/management-system/apps/backend/

echo "[4/4] restart backend service"
# sudo systemctl restart management-backend

echo "done"
