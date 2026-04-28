#!/usr/bin/env python3
# input: project script/director bible and storyboard model boundary env vars
# output: per-episode draft storyboard JSON under output/storyboard/draft/
# pos: batch storyboard draft generation helper
"""
Batch storyboard generation using parallel model boundary calls.

Two-pass architecture:
  Pass 0: caller provides or prepares per-episode director notes
  Pass 1: configured text provider generates per-scene shot prompts (N parallel calls)

Usage:
  python3 storyboard_batch.py <project_dir> [--dry-run] [--episodes ep001,ep002]
  python3 storyboard_batch.py <project_dir> --concurrency 5
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROMPT_FILE = SCRIPT_DIR / "prompts" / "storyboard_system.txt"
DEFAULT_TEXT_MODEL = "gemini-3.1-flash-lite"
_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run
from storyboard_contract import (
    StoryboardContractError,
    validate_scene_shots as _contract_validate_scene_shots,
    validate_shot,
)
from apply_storyboard_result import apply_storyboard_result


def get_default_text_model() -> str:
    return os.environ.get("STORYBOARD_TEXT_MODEL") or os.environ.get(
        "GEMINI_TEXT_MODEL", DEFAULT_TEXT_MODEL
    )


class StoryboardModelClient:
    provider = "aos-cli"

    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir).resolve()

    def generate(self, system_prompt: str, user_content: str, model: str | None) -> object:
        request = {
            "apiVersion": "aos-cli.model/v1",
            "task": "storyboard.batch",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {
                "system": system_prompt,
                "content": user_content,
            },
            "options": {
                "temperature": float(
                    os.environ.get(
                        "STORYBOARD_TEXT_TEMPERATURE",
                        os.environ.get("GEMINI_TEXT_TEMPERATURE", "0.6"),
                    )
                ),
                "maxOutputTokens": int(
                    os.environ.get(
                        "STORYBOARD_TEXT_MAX_OUTPUT_TOKENS",
                        os.environ.get("GEMINI_TEXT_MAX_OUTPUT_TOKENS", "6000"),
                    )
                ),
            },
        }
        if model:
            request["modelPolicy"] = {"model": model}

        with tempfile.TemporaryDirectory(prefix="storyboard-aos-cli-") as tmp:
            request_path = Path(tmp) / "request.json"
            response_path = Path(tmp) / "response.json"
            request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
            completed = aos_cli_model_run(request_path, response_path, cwd=self.project_dir)
            response = _read_response_envelope(response_path)

        if not response:
            if completed.returncode != 0:
                raise RuntimeError(
                    completed.stderr or f"aos-cli failed with exit code {completed.returncode}"
                )
            raise RuntimeError("aos-cli did not write a response envelope")

        if not response.get("ok"):
            error = response.get("error") or {}
            raise RuntimeError(error.get("message") or "aos-cli model generation failed")

        output = response.get("output") or {}
        if "data" in output and output["data"] is not None:
            return output["data"]
        if "text" in output and output["text"]:
            return parse_storyboard_output_text(output["text"])
        raise RuntimeError("aos-cli response missing storyboard output.data/output.text")


def _read_response_envelope(response_path: Path) -> dict:
    if not response_path.exists():
        return {}
    try:
        return json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli response envelope: {response_path}") from exc


def _repair_json_strings(text: str) -> str:
    """Escape literal newlines/tabs inside JSON string values."""
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            result.append(ch)
            escape_next = False
        elif ch == "\\" and in_string:
            result.append(ch)
            escape_next = True
        elif ch == '"':
            result.append(ch)
            in_string = not in_string
        elif in_string and ch == "\n":
            result.append("\\n")
        elif in_string and ch == "\r":
            result.append("\\r")
        elif in_string and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
    return "".join(result)


def parse_storyboard_output_text(text: str) -> object:
    text = (text or "").strip()
    if not text:
        raise RuntimeError("aos-cli response missing storyboard content")
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try ALL markdown-fenced blocks; prefer the LAST one (after model thinking/reasoning)
    fence_blocks = re.findall(r"```(?:json)?[ \t]*\n(.*?)\n?```", text, re.DOTALL)
    candidates = [b.strip() for b in reversed(fence_blocks) if b.strip()]
    # Also try from last then first JSON bracket (handles thinking preamble)
    for rfind_char in ("[", "{"):
        idx = text.rfind(rfind_char)
        if idx >= 0:
            candidates.append(text[idx:])
    for find_char in ("[", "{"):
        idx = text.find(find_char)
        if idx >= 0:
            candidates.append(text[idx:])
    for source in candidates:
        # Try as-is
        try:
            return json.loads(source)
        except json.JSONDecodeError:
            pass
        # Repair literal control characters inside JSON strings, then retry
        try:
            return json.loads(_repair_json_strings(source))
        except json.JSONDecodeError:
            pass
    # Final fallback: return raw text
    return text


def normalize_scene_shots(raw_output, scene: dict | None = None) -> list[dict]:
    """Coerce LLM output into a clean [{id, duration, prompt}] list.

    Accepts a list of dicts (canonical) or a single dict; rejects anything else.
    Strips unknown fields; backfills `id` from scene_id + ordinal when missing.
    Final structural validation is delegated to storyboard_contract.validate_shot.
    """
    if isinstance(raw_output, dict):
        raw_items = raw_output.get("shots", [raw_output])
    elif isinstance(raw_output, list):
        raw_items = raw_output
    else:
        raise ValueError(
            f"storyboard output must be a JSON array; got {type(raw_output).__name__}"
        )

    scene_id_raw = (scene or {}).get("scene_id", "")
    m = re.match(r"scn_?(\d+)", str(scene_id_raw))
    scene_num = f"{int(m.group(1)):03d}" if m else "000"

    normalized = []
    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            raise ValueError(
                f"shot[{index - 1}] must be an object, got {type(item).__name__}"
            )
        candidate = {
            "id": item.get("id") or f"scn_{scene_num}_clip{index:03d}",
            "duration": item.get("duration"),
            "prompt": item.get("prompt"),
        }
        try:
            validate_shot(candidate, f"shot[{index - 1}]")
        except StoryboardContractError as exc:
            raise ValueError(str(exc)) from exc
        normalized.append(candidate)

    return normalized


def validate_scene_shots(shots: list[dict], scene: dict | None) -> tuple[bool, str]:
    """Final post-normalization check returning a (ok, message) tuple.

    Delegates structural rules (id format, duration range, sequence) to
    storyboard_contract.validate_scene_shots; this wrapper preserves the
    legacy tuple-return signature used by generate_all_storyboards logging.
    """
    label = f"scene({(scene or {}).get('scene_id', '?')})"
    try:
        _contract_validate_scene_shots(shots, label)
    except StoryboardContractError as exc:
        return False, str(exc)
    total = sum(sh["duration"] for sh in shots)
    return True, f"shots={len(shots)} total_duration={total}s"


def load_storyboard_client(project_dir: Path):
    return StoryboardModelClient(project_dir=project_dir)


def build_actors_catalog(script: dict) -> list[dict]:
    """Project script.actors[] into a compact catalog for storyboard prompts.

    Each entry only carries (actor_id, actor_name, states[]) where states is
    a list of {state_id, state_name}. This is what the LLM needs to decide
    whether to emit `@act_xxx` (single state) vs `@act_xxx:st_yyy` (multi-state).
    """
    out = []
    for actor in script.get("actors", []) or []:
        if not isinstance(actor, dict):
            continue
        actor_id = actor.get("actor_id")
        if not actor_id:
            continue
        states_in = actor.get("states") or []
        states_out = []
        for st in states_in:
            if not isinstance(st, dict):
                continue
            sid = st.get("state_id")
            sname = st.get("state_name") or ""
            if sid:
                states_out.append({"state_id": sid, "state_name": sname})
        out.append({
            "actor_id": actor_id,
            "actor_name": actor.get("actor_name", ""),
            "states": states_out,
        })
    return out


def render_actors_catalog(catalog: list[dict]) -> str:
    if not catalog:
        return ""
    lines = []
    for actor in catalog:
        states = actor.get("states") or []
        if not states:
            lines.append(f"- {actor['actor_id']} ({actor.get('actor_name', '')}): 单状态，引用写 @{actor['actor_id']}")
            continue
        state_str = "; ".join(f"{s['state_id']}={s['state_name']}" for s in states)
        lines.append(
            f"- {actor['actor_id']} ({actor.get('actor_name', '')}): 多状态[{state_str}]，"
            f"引用必须写 @{actor['actor_id']}:st_xxx"
        )
    return "\n".join(lines)


def generate_scene_prompt(client, system_prompt: str, ep_notes: str, scene: dict, model: str,
                           actors_catalog: list[dict] | None = None) -> list[dict]:
    catalog_block = ""
    if actors_catalog:
        catalog_block = (
            "\n本剧本注册的角色状态目录（写 token 时遵守此约束）：\n"
            f"{render_actors_catalog(actors_catalog)}\n"
            "规则：当一个角色注册了多个 state 时，引用必须写成 `@act_xxx:st_yyy` 形式；"
            "只有一个 state 或无 state 时使用 `@act_xxx` 即可。"
            "禁止跨越目录虚构 state_id。\n"
        )
    scene_id = scene.get("scene_id", "scn_000")
    user_content = (
        f"导演笔记:\n{ep_notes}\n"
        f"{catalog_block}\n"
        f"场景 JSON:\n{json.dumps(scene, ensure_ascii=False)}\n\n"
        f"为本场（scene_id={scene_id}）输出一个 shot 数组。每个 shot 是一个独立的视频生成单元，"
        "字段固定为 `id` / `duration` / `prompt` 三项：\n"
        f"- id: 形如 `{scene_id}_clip001`，clip 序号从 001 开始顺序递增\n"
        "- duration: 整数秒，范围 [4,15]，根据该 shot 的戏剧节奏选择 (短反应 4-5 / 中等动作 6-8 / "
        "持续节拍 10-12 / 长镜 13-15)，不要全部填 5\n"
        "- prompt: 单条镜头的 markdown 提示词，遵守 system 中规定的 `景别|运镜 / 总体描述 / 动作 / "
        "角色状态 / 音效 / 对白` 块结构与 token 规则\n"
        "shot 数量由你根据剧本节奏决定，没有固定下限或上限。\n"
        "输出严格 JSON 数组，不要 markdown fence，不要解释文字。"
    )
    raw = client.generate(
        system_prompt=system_prompt,
        user_content=user_content,
        model=model,
    )
    shots = normalize_scene_shots(raw, scene)
    ok, msg = validate_scene_shots(shots, scene)
    if not ok:
        raise RuntimeError(f"storyboard validation failed: {msg}")
    return shots


def generate_all_storyboards(project_dir: Path, bible: dict, script: dict,
                              dry_run: bool = False, concurrency: int = 5,
                              model: str | None = None) -> tuple[bool, str]:
    """Main entry: generate storyboards for all episodes."""
    output_dir = project_dir / "output"
    episodes = script.get("episodes", [])

    total_scenes = sum(len(ep.get("scenes", [])) for ep in episodes)
    print(f"[storyboard] {len(episodes)} episodes, {total_scenes} scenes, concurrency={concurrency}")

    if dry_run:
        for ep in episodes:
            ep_id = ep.get("episode_id") or ep.get("ep_id", "?")
            n_scenes = len(ep.get("scenes", []))
            print(f"  DRY RUN: {ep_id} -> {n_scenes} scenes")
        return True, f"DRY RUN ({total_scenes} scenes)"

    system_prompt = PROMPT_FILE.read_text() if PROMPT_FILE.exists() else "Generate video storyboard prompts."

    client = load_storyboard_client(project_dir=project_dir)
    model = model or get_default_text_model()

    ep_notes_map = bible.get("episodes", {})
    global_style = json.dumps(bible.get("global_style", {}), ensure_ascii=False)
    actors_catalog = build_actors_catalog(script)

    t0 = time.time()

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {}
        for ep in episodes:
            ep_id = ep.get("episode_id") or ep.get("ep_id", "unknown")
            ep_notes = json.dumps(ep_notes_map.get(ep_id, {}), ensure_ascii=False)
            full_notes = f"全局风格: {global_style}\n\n本集导演笔记: {ep_notes}"

            for scene in ep.get("scenes", []):
                future = pool.submit(
                    generate_scene_prompt, client, system_prompt, full_notes,
                    scene, model, actors_catalog
                )
                futures[future] = (ep_id, scene.get("scene_id", "unknown"))

        storyboards = {}
        failures = []
        for future in as_completed(futures):
            ep_id, scene_id = futures[future]
            try:
                shots = future.result()
                storyboards[(ep_id, scene_id)] = shots
                print(f"  OK {ep_id}/{scene_id}: {len(shots)} shots")
            except Exception as e:
                failures.append(f"{ep_id}/{scene_id}: {e}")
                print(f"  FAIL {ep_id}/{scene_id}: {e}", file=sys.stderr)

    elapsed = time.time() - t0
    if failures:
        return False, f"FAILED ({len(failures)} scene failures, {elapsed:.0f}s): " + "; ".join(failures)

    for ep in episodes:
        ep_id = ep.get("episode_id") or ep.get("ep_id", "unknown")
        for scene in ep.get("scenes", []):
            scene_id = scene.get("scene_id", "unknown")
            shots = storyboards.get((ep_id, scene_id), [])
            if not shots:
                continue
            payload = {
                "episode_id": ep_id,
                "scene_id": scene_id,
                "shots": shots,
            }
            apply_storyboard_result(project_dir, payload, finalize_stage=False)
            print(f"  -> wrote {ep_id}/{scene_id} via apply_storyboard_result")

    return True, f"OK ({total_scenes} scenes, {elapsed:.0f}s)"


def main():
    parser = argparse.ArgumentParser(description="Batch storyboard generation")
    parser.add_argument("project_dir", help="Project directory")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--episodes", help="Comma-separated episode filter")
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--model", default=get_default_text_model())
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    output_dir = project_dir / "output"

    script = json.loads((output_dir / "script.json").read_text())
    bible = json.loads((output_dir / "director_bible.json").read_text())

    if args.episodes:
        ep_filter = set(args.episodes.split(","))
        script["episodes"] = [ep for ep in script["episodes"] if (ep.get("episode_id") or ep.get("ep_id")) in ep_filter]

    ok, status = generate_all_storyboards(
        project_dir, bible, script,
        dry_run=args.dry_run, concurrency=args.concurrency, model=args.model
    )
    print(f"\n[storyboard] {status}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
