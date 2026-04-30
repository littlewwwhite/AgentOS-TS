#!/usr/bin/env bash
# input: --project <name>
# output: pid liveness, pipeline-state.json digest, last 20 log lines
# pos: read-only status helper paired with run_pipeline.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    -h|--help)
      echo "usage: $(basename "$0") --project <name>"; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "usage: $(basename "$0") --project <name>" >&2
  exit 2
fi

PROJECT_DIR="$REPO_ROOT/workspace/$PROJECT"
LOG_DIR="$PROJECT_DIR/.logs"
PID_FILE="$LOG_DIR/pipeline.pid"
STATE_FILE="$PROJECT_DIR/pipeline-state.json"
LATEST_LOG="$LOG_DIR/pipeline-latest.log"

echo "=== pipeline status: $PROJECT ==="

if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "pid: $PID (running)"
  else
    echo "pid: ${PID:-<empty>} (stale)"
  fi
else
  echo "pid: (no pid file)"
fi

echo
if [[ -f "$STATE_FILE" ]]; then
  echo "--- pipeline-state.json ---"
  if command -v jq >/dev/null 2>&1; then
    jq '{
      current_stage,
      next_action,
      last_error,
      stages: (.stages // {} | to_entries | map({stage: .key, status: .value.status})),
      episodes: (.episodes // {} | to_entries | map({
        ep: .key,
        sb: .value.storyboard.status,
        vid: .value.video.status,
        edit: .value.editing.status,
        music: .value.music.status,
        sub: .value.subtitle.status
      }))
    }' "$STATE_FILE"
  else
    cat "$STATE_FILE"
  fi
else
  echo "--- no state file at $STATE_FILE ---"
fi

echo
if [[ -f "$LATEST_LOG" ]]; then
  REAL_LOG=$(readlink "$LATEST_LOG" 2>/dev/null || echo "$LATEST_LOG")
  echo "--- last 20 log lines ($REAL_LOG) ---"
  tail -n 20 "$LATEST_LOG"
else
  echo "--- no log file at $LATEST_LOG ---"
fi
