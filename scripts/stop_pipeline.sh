#!/usr/bin/env bash
# input: --project <name>
# output: SIGTERM the running pipeline pid, escalate to SIGKILL if still alive after 5s
# pos: idempotent stop helper paired with run_pipeline.sh
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

PID_FILE="$REPO_ROOT/workspace/$PROJECT/.logs/pipeline.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "no pid file at $PID_FILE — nothing to stop"
  exit 0
fi

PID=$(cat "$PID_FILE" 2>/dev/null || true)
if [[ -z "$PID" ]]; then
  echo "pid file empty; removing"
  rm -f "$PID_FILE"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  echo "pid=$PID not running; cleaning pid file"
  rm -f "$PID_FILE"
  exit 0
fi

kill "$PID"
echo "sent SIGTERM to pid=$PID"
for _ in 1 2 3 4 5; do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "stopped"
    exit 0
  fi
done

kill -9 "$PID" 2>/dev/null || true
echo "sent SIGKILL to pid=$PID"
rm -f "$PID_FILE"
