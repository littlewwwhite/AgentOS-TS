#!/usr/bin/env bash
# input: --project <name> [--prompt <file>] [--resume <session_id>] [--foreground]
# output: launches apps/console/headless.ts (nohup by default), prints pid + log paths
# pos: generic launcher for AgentOS pipeline runs; reusable across workspaces
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_PROMPT="$SCRIPT_DIR/pipeline-prompt.md"

PROJECT=""
PROMPT_FILE="$DEFAULT_PROMPT"
RESUME=""
FOREGROUND=0

usage() {
  cat <<EOF
usage: $(basename "$0") --project <name> [--prompt <file>] [--resume <session_id>] [--foreground]

Starts a headless AgentOS pipeline run for workspace/<name>/.

Options:
  --project <name>        project directory under workspace/ (required)
  --prompt <file>         prompt file (default: scripts/pipeline-prompt.md)
  --resume <session_id>   resume an existing Claude Agent SDK session
  --foreground            run in foreground (default: nohup background)
  -h, --help              show this help

The launcher refuses to start if a previous run is still alive (pid file
points at a live process). State + artifacts live under workspace/<name>/;
logs land in workspace/<name>/.logs/.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --prompt) PROMPT_FILE="${2:-}"; shift 2 ;;
    --resume) RESUME="${2:-}"; shift 2 ;;
    --foreground) FOREGROUND=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "error: --project required" >&2
  usage >&2
  exit 2
fi

PROJECT_DIR="$REPO_ROOT/workspace/$PROJECT"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "error: project dir not found: $PROJECT_DIR" >&2
  exit 2
fi
if [[ ! -f "$PROJECT_DIR/source.txt" ]]; then
  echo "error: $PROJECT_DIR/source.txt missing — pipeline needs source material" >&2
  exit 2
fi
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "error: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi
if [[ ! -f "$REPO_ROOT/apps/console/headless.ts" ]]; then
  echo "error: apps/console/headless.ts missing — repo layout broken" >&2
  exit 2
fi

LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"
PID_FILE="$LOG_DIR/pipeline.pid"
TS=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/pipeline-$TS.log"
LATEST_LINK="$LOG_DIR/pipeline-latest.log"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "error: pipeline already running for project=$PROJECT (pid=$OLD_PID)" >&2
    echo "       stop it first: $SCRIPT_DIR/stop_pipeline.sh --project $PROJECT" >&2
    exit 3
  fi
  rm -f "$PID_FILE"
fi

ARGS=( apps/console/headless.ts --project "$PROJECT" --prompt-file "$PROMPT_FILE" )
if [[ -n "$RESUME" ]]; then
  ARGS+=( --resume "$RESUME" )
fi

cd "$REPO_ROOT"

if [[ "$FOREGROUND" -eq 1 ]]; then
  echo "running in foreground: bun ${ARGS[*]}"
  exec bun "${ARGS[@]}"
fi

nohup bun "${ARGS[@]}" >"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"
ln -sfn "$LOG_FILE" "$LATEST_LINK"

cat <<EOF
started:
  project: $PROJECT
  pid:     $PID
  log:     $LOG_FILE
  latest:  $LATEST_LINK
  state:   $PROJECT_DIR/pipeline-state.json (created/updated by agent)

monitor:
  tail -f $LATEST_LINK
  $SCRIPT_DIR/status_pipeline.sh --project $PROJECT

stop:
  $SCRIPT_DIR/stop_pipeline.sh --project $PROJECT
EOF
