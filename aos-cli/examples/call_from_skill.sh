#!/usr/bin/env bash
set -euo pipefail

REQUEST="${1:?usage: call_from_skill.sh REQUEST_JSON OUTPUT_JSON}"
OUTPUT="${2:?usage: call_from_skill.sh REQUEST_JSON OUTPUT_JSON}"

uv run --project aos-cli aos-cli model run \
    --input "${REQUEST}" \
    --output "${OUTPUT}"
