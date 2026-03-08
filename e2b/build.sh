#!/usr/bin/env bash
# Build E2B template from the AgentOS-TS project root
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Building TypeScript..."
cd "$PROJECT_ROOT"
bun run build

echo "==> Syncing artifacts to e2b/..."
rsync -a --delete "$PROJECT_ROOT/dist/" "$SCRIPT_DIR/dist/"
rsync -a --delete "$PROJECT_ROOT/node_modules/" "$SCRIPT_DIR/node_modules/"
rsync -a --delete "$PROJECT_ROOT/skills/" "$SCRIPT_DIR/skills/"
cp "$PROJECT_ROOT/package.json" "$SCRIPT_DIR/package.json"

echo "==> Building E2B template..."
cd "$SCRIPT_DIR"
e2b template build \
  --dockerfile e2b.Dockerfile \
  --name agentos-sandbox \
  --start-cmd "bun /app/dist/sandbox.js /app/workspace --skills /app/skills"

echo "==> Done."
