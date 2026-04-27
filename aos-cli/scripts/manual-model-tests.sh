#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/.." && pwd)"
ENV_FILE="${AOS_CLI_ENV_FILE:-$REPO_ROOT/.env}"
WORK_DIR="${AOS_CLI_TEST_DIR:-/tmp/aos-cli-model-tests}"
ARTIFACT_DIR="$WORK_DIR/artifacts"

mkdir -p "$WORK_DIR" "$ARTIFACT_DIR"
cd "$REPO_ROOT"

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r assignment; do
    export "$assignment"
  done < <(
    PYTHONPATH="$PACKAGE_DIR/src" python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import os
import sys

from aos_cli.env import parse_env_line

for raw_line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    parsed = parse_env_line(raw_line)
    if parsed is None:
        continue
    key, value = parsed
    if key in os.environ:
        continue
    print(f"{key}={value}")
PY
  )
fi

run_cli() {
  uv run --project "$PACKAGE_DIR" aos-cli --env-file "$ENV_FILE" "$@"
}

json_string() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
    return
  fi
  python - "$1" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
}

prompt_or_default() {
  local default_prompt="$1"
  local provided_prompt="${2:-}"
  if [[ -n "$provided_prompt" ]]; then
    printf '%s' "$provided_prompt"
    return
  fi
  if [[ -t 0 ]]; then
    local prompt
    printf '提示词: ' >&2
    read -r prompt
    printf '%s' "$prompt"
    return
  fi
  printf '%s' "$default_prompt"
}

write_json() {
  local path="$1"
  shift
  mkdir -p "$(dirname "$path")"
  cat > "$path"
}

print_file() {
  local path="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "$path"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$path"
    return
  fi
  python -m json.tool "$path"
}

print_text_output() {
  local path="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
output = payload.get("output") or {}
if payload.get("ok") is True and output.get("kind") == "text" and "text" in output:
    print("\n文本输出:")
    print(output["text"])
PY
    return
  fi
  python - "$path" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
output = payload.get("output") or {}
if payload.get("ok") is True and output.get("kind") == "text" and "text" in output:
    print("\n文本输出:")
    print(output["text"])
PY
}

require_env() {
  local missing=()
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    printf '缺少环境变量: %s\n' "${missing[*]}" >&2
    return 1
  fi
}

pause() {
  printf '\n按 Enter 继续...'
  read -r _
}

capabilities() {
  run_cli model capabilities --json
}

preflight() {
  run_cli model preflight --json
}

real_text() {
  require_env GEMINI_API_KEY || return 1
  local default_prompt="为月光庭院场景写一句简短的制作说明。"
  local prompt_json
  prompt_json="$(json_string "$(prompt_or_default "$default_prompt" "${1:-}")")"
  local request="$WORK_DIR/text.real.request.json"
  local response="$WORK_DIR/text.real.response.json"
  write_json "$request" <<JSON
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.text.real",
  "capability": "generate",
  "output": {"kind": "text"},
  "input": {
    "system": "Answer the user request directly and concisely.",
    "content": $prompt_json
  },
  "options": {"temperature": 0.2}
}
JSON
  run_cli model validate --input "$request"
  run_cli model run --input "$request" --output "$response"
  print_file "$response"
  print_text_output "$response"
}

real_json_text() {
  require_env GEMINI_API_KEY || return 1
  local default_prompt="返回一个包含 scene、mood 和 camera 字段的月光庭院镜头对象。"
  local prompt_json
  prompt_json="$(json_string "$(prompt_or_default "$default_prompt" "${1:-}")")"
  local request="$WORK_DIR/text.json.request.json"
  local response="$WORK_DIR/text.json.response.json"
  write_json "$request" <<JSON
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.text.json",
  "capability": "generate",
  "output": {"kind": "json"},
  "input": {
    "system": "Return only JSON.",
    "content": $prompt_json
  },
  "options": {"temperature": 0}
}
JSON
  run_cli model validate --input "$request"
  run_cli model run --input "$request" --output "$response"
  print_file "$response"
}

real_image_remote() {
  require_env OPENAI_API_KEY || return 1
  local default_prompt="月光下的电影感角色概念肖像，高细节。"
  local prompt_json
  prompt_json="$(json_string "$(prompt_or_default "$default_prompt" "${1:-}")")"
  local request="$WORK_DIR/image.real.remote.request.json"
  local response="$WORK_DIR/image.real.remote.response.json"
  write_json "$request" <<JSON
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.image.real.remote",
  "capability": "image.generate",
  "output": {"kind": "artifact"},
  "input": {"prompt": $prompt_json},
  "artifactPolicy": {"download": false, "role": "character.front"}
}
JSON
  run_cli model validate --input "$request"
  run_cli model run --input "$request" --output "$response"
  print_file "$response"
}

real_image_download() {
  require_env OPENAI_API_KEY || return 1
  local default_prompt="月光下的电影感角色概念肖像，高细节。"
  local prompt_json
  prompt_json="$(json_string "$(prompt_or_default "$default_prompt" "${1:-}")")"
  local request="$WORK_DIR/image.real.download.request.json"
  local response="$WORK_DIR/image.real.download.response.json"
  local local_dir_json
  local_dir_json="$(json_string "$ARTIFACT_DIR/image-real")"
  write_json "$request" <<JSON
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.image.real.download",
  "capability": "image.generate",
  "output": {"kind": "artifact"},
  "input": {"prompt": $prompt_json},
  "artifactPolicy": {
    "download": true,
    "localDir": $local_dir_json,
    "role": "character.front"
  }
}
JSON
  run_cli model validate --input "$request"
  run_cli model run --input "$request" --output "$response"
  print_file "$response"
}

real_video_submit() {
  require_env ARK_API_KEY || return 1
  local default_prompt="镜头缓慢推进穿过月光庭院，电影感光影。"
  local prompt_json
  prompt_json="$(json_string "$(prompt_or_default "$default_prompt" "${1:-}")")"
  local request="$WORK_DIR/video.real.submit.request.json"
  local task="$WORK_DIR/video.real.task.json"
  write_json "$request" <<JSON
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.video.real",
  "capability": "video.generate",
  "output": {"kind": "task"},
  "input": {
    "prompt": $prompt_json,
    "duration": 5,
    "ratio": "16:9",
    "resolution": "720p"
  }
}
JSON
  run_cli model validate --input "$request"
  run_cli model submit --input "$request" --output "$task"
  print_file "$task"
  printf '\n任务文件: %s\n' "$task"
}

real_video_poll() {
  require_env ARK_API_KEY || return 1
  local task_path="${1:-}"
  if [[ -z "$task_path" ]]; then
    printf '任务 JSON 路径 [%s/video.real.task.json]: ' "$WORK_DIR"
    read -r task_path
    task_path="${task_path:-$WORK_DIR/video.real.task.json}"
  fi
  local result="$WORK_DIR/video.real.result.json"
  run_cli model poll --input "$task_path" --output "$result"
  print_file "$result"
}

run_negative_validation() {
  local path="$1"
  local summary="$2"
  local output
  local status
  set +e
  output="$(run_cli model validate --input "$path" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf '校验结果: 未发现预期错误\n'
    printf '退出码: %s\n\n' "$status"
    return 1
  fi
  printf '校验结果: %s\n' "$summary"
  printf '退出码: %s\n\n' "$status"
}

negative_validation() {
  local missing_api="$WORK_DIR/invalid.missing-api-version.json"
  local bad_kind="$WORK_DIR/invalid.bad-kind.json"
  local bad_capability="$WORK_DIR/invalid.bad-capability.json"

  write_json "$missing_api" <<'JSON'
{
  "task": "manual.invalid.missing_api",
  "capability": "generate",
  "output": {"kind": "text"},
  "input": {"content": "hi"}
}
JSON
  write_json "$bad_kind" <<'JSON'
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.invalid.bad_kind",
  "capability": "generate",
  "output": {"kind": "artifact"},
  "input": {"content": "hi"}
}
JSON
  write_json "$bad_capability" <<'JSON'
{
  "apiVersion": "aos-cli.model/v1",
  "task": "manual.invalid.bad_capability",
  "capability": "storyboard.render",
  "output": {"kind": "text"},
  "input": {"content": "hi"}
}
JSON

  local failures=0
  run_negative_validation "$missing_api" "缺少必填字段 apiVersion" || failures=$((failures + 1))
  run_negative_validation "$bad_kind" "不支持的输出类型 artifact" || failures=$((failures + 1))
  run_negative_validation "$bad_capability" "不支持的能力 storyboard.render" || failures=$((failures + 1))
  if [[ "$failures" -gt 0 ]]; then
    return 1
  fi
}

show_menu() {
  cat <<MENU

aos-cli 模型手动测试
工作目录: $WORK_DIR

1) 能力列表
2) 预检环境
3) 真实文本生成 (Gemini)
4) 真实 JSON 生成 (Gemini)
5) 真实图片生成，仅返回远程产物 (OpenAI 兼容)
6) 真实图片生成，下载产物 (OpenAI 兼容)
7) 真实视频提交 (Ark)
8) 真实视频轮询 (Ark)
9) 负向校验测试
0) 退出
MENU
}

run_choice() {
  local choice="$1"
  shift || true
  case "$choice" in
    1) capabilities ;;
    2) preflight ;;
    3) real_text "$*" ;;
    4) real_json_text "$*" ;;
    5) real_image_remote "$*" ;;
    6) real_image_download "$*" ;;
    7) real_video_submit "$*" ;;
    8) real_video_poll "$@" ;;
    9) negative_validation ;;
    0) exit 0 ;;
    *) printf '未知选项: %s\n' "$choice" >&2; return 1 ;;
  esac
}

if [[ $# -gt 0 ]]; then
  run_choice "$@"
  exit $?
fi

while true; do
  show_menu
  printf '请选择测试: '
  read -r choice
  run_choice "$choice" || true
done
