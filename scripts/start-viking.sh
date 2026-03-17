#!/usr/bin/env bash
# scripts/start-viking.sh
# Start OpenViking server as a sidecar for AgentOS-TS
set -euo pipefail

VIKING_PORT="${OPENVIKING_PORT:-1933}"
VIKING_DATA="${OPENVIKING_DATA:-$HOME/.openviking/data}"
VIKING_CONF="${OPENVIKING_CONF:-$HOME/.openviking/ov.conf}"

# Install if needed
if ! command -v openviking-server &> /dev/null; then
  echo "Installing OpenViking..."
  uv pip install openviking --upgrade
fi

# Generate minimal config if not exists
if [ ! -f "$VIKING_CONF" ]; then
  mkdir -p "$(dirname "$VIKING_CONF")"
  cat > "$VIKING_CONF" << EOF
{
  "storage": {
    "path": "$VIKING_DATA"
  },
  "server": {
    "host": "127.0.0.1",
    "port": $VIKING_PORT
  },
  "embedding": {
    "provider": "openai",
    "api_base": "${OPENAI_API_BASE:-http://127.0.0.1:8317/v1}",
    "model": "${EMBEDDING_MODEL:-text-embedding-3-small}",
    "max_concurrent": 5
  }
}
EOF
  echo "Generated config at $VIKING_CONF"
fi

echo "Starting OpenViking on port $VIKING_PORT..."
exec openviking-server --config "$VIKING_CONF" --port "$VIKING_PORT"
