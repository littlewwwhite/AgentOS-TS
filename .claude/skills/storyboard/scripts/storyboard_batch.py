#!/usr/bin/env python3
# input: project script/director bible and storyboard LLM provider env vars
# output: per-episode draft storyboard JSON under output/storyboard/draft/
# pos: batch storyboard draft generation helper
"""
Batch storyboard generation using parallel LLM API calls.

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
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = Path(__file__).parent
PROMPT_FILE = SCRIPT_DIR / "prompts" / "storyboard_system.txt"
DEFAULT_TEXT_PROVIDER = "chatfire"
DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite"
DEFAULT_CHATFIRE_TEXT_MODEL = DEFAULT_GEMINI_TEXT_MODEL


def get_text_provider() -> str:
    return os.environ.get("STORYBOARD_TEXT_PROVIDER", DEFAULT_TEXT_PROVIDER).strip().lower()


def get_default_text_model() -> str:
    provider = get_text_provider()
    if provider == "chatfire":
        return os.environ.get("CHATFIRE_TEXT_MODEL", DEFAULT_CHATFIRE_TEXT_MODEL)
    return os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL)


class GeminiStoryboardClient:
    provider = "gemini"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate(self, system_prompt: str, user_content: str, model: str) -> str:
        try:
            from google import genai
            from google.genai import types
        except ImportError as e:
            raise RuntimeError(
                "Gemini storyboard generation requires the official google-genai package"
            ) from e

        client = genai.Client(api_key=self.api_key)
        response = client.models.generate_content(
            model=model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                temperature=float(os.environ.get("GEMINI_TEXT_TEMPERATURE", "0.6")),
                max_output_tokens=int(os.environ.get("GEMINI_TEXT_MAX_OUTPUT_TOKENS", "2000")),
            ),
        )
        text = getattr(response, "text", "") or ""
        if not text.strip():
            raise RuntimeError("Gemini response missing text")
        return text.strip()


class ChatFireStoryboardClient:
    provider = "chatfire"

    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        normalized_base = base_url.rstrip("/")
        if normalized_base.endswith("/chat/completions"):
            self.chat_completions_url = normalized_base
            self.base_url = normalized_base.rsplit("/chat/completions", 1)[0]
        elif normalized_base.endswith("/v1"):
            self.base_url = normalized_base
            self.chat_completions_url = f"{normalized_base}/chat/completions"
        else:
            self.base_url = f"{normalized_base}/v1"
            self.chat_completions_url = f"{self.base_url}/chat/completions"

    def generate(self, system_prompt: str, user_content: str, model: str) -> str:
        body = {
            "model": model,
            "stream": False,
            "max_tokens": 2000,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        }
        request = urllib.request.Request(
            self.chat_completions_url,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"ChatFire API failed HTTP {e.code}: {e.read().decode()}") from e
        return extract_chat_completion_text(payload)


def extract_chat_completion_text(response: dict) -> str:
    """Extract text from an OpenAI-compatible chat completion response."""
    choices = response.get("choices") or []
    if not choices:
        raise RuntimeError(f"Chat completion response missing choices: {response}")
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "".join(parts)
    raise RuntimeError(f"Unsupported chat completion content: {content}")


def normalize_scene_shots(raw_output) -> list[dict]:
    """Normalize storyboard model output to [{source_refs, prompt}]."""
    if isinstance(raw_output, dict):
        raw_items = raw_output.get("shots", [raw_output])
    elif isinstance(raw_output, list):
        raw_items = raw_output
    else:
        raw_items = [raw_output]

    normalized = []
    for item in raw_items:
        if isinstance(item, str):
            normalized.append({
                "source_refs": [],
                "prompt": item,
            })
            continue

        if isinstance(item, dict):
            prompt = item.get("prompt")
            if prompt:
                normalized.append({
                    "source_refs": item.get("source_refs", []),
                    "prompt": prompt,
                })
                continue

        normalized.append({
            "source_refs": [],
            "prompt": json.dumps(item, ensure_ascii=False) if not isinstance(item, str) else item,
        })

    return normalized


def load_storyboard_client():
    """Initialize the storyboard LLM client from environment variables."""
    provider = get_text_provider()
    if provider in {"gemini", "google", "google-genai", "google_genai"}:
        gemini_api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not gemini_api_key:
            print("[ERROR] GEMINI_API_KEY not set", file=sys.stderr)
            sys.exit(1)
        return GeminiStoryboardClient(api_key=gemini_api_key)

    if provider != "chatfire":
        print(f"[ERROR] Unsupported STORYBOARD_TEXT_PROVIDER={provider}", file=sys.stderr)
        sys.exit(1)

    chatfire_api_key = os.environ.get("GEMINI_API_KEY")
    if not chatfire_api_key:
        print("[ERROR] GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    return ChatFireStoryboardClient(
        api_key=chatfire_api_key,
        base_url=os.environ.get("CHATFIRE_BASE_URL", "https://api.chatfire.cn/v1"),
    )


def generate_scene_prompt(client, system_prompt: str, ep_notes: str, scene: dict, model: str) -> dict:
    """Generate storyboard prompt for a single scene via the configured LLM API."""
    text = client.generate(
        system_prompt=system_prompt,
        user_content=(
            f"导演笔记:\n{ep_notes}\n\n"
            f"场景 JSON:\n{json.dumps(scene, ensure_ascii=False)}\n\n"
            "请只输出 JSON 数组或对象，最终会被规范化为 "
            "[{\"source_refs\": [\"beat_id\"], \"prompt\": \"...\"}]。"
        ),
        model=model,
    )
    # Extract JSON from response
    try:
        # Try to parse directly
        return normalize_scene_shots(json.loads(text))
    except json.JSONDecodeError:
        # Try to find JSON in markdown code block
        import re
        match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
        if match:
            return normalize_scene_shots(json.loads(match.group(1)))
        return normalize_scene_shots(text)


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
            ep_id = ep.get("ep_id", "?")
            n_scenes = len(ep.get("scenes", []))
            print(f"  DRY RUN: {ep_id} -> {n_scenes} scenes")
        return True, f"DRY RUN ({total_scenes} scenes)"

    # Load system prompt
    system_prompt = PROMPT_FILE.read_text() if PROMPT_FILE.exists() else "Generate video storyboard prompts."

    # Initialize storyboard LLM client
    client = load_storyboard_client()
    model = model or get_default_text_model()

    # Per-episode director notes from bible
    ep_notes_map = bible.get("episodes", {})
    global_style = json.dumps(bible.get("global_style", {}), ensure_ascii=False)

    t0 = time.time()

    # Parallel scene prompt generation
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {}
        for ep in episodes:
            ep_id = ep.get("ep_id", "unknown")
            ep_notes = json.dumps(ep_notes_map.get(ep_id, {}), ensure_ascii=False)
            full_notes = f"全局风格: {global_style}\n\n本集导演笔记: {ep_notes}"

            for scene in ep.get("scenes", []):
                future = pool.submit(
                    generate_scene_prompt, client, system_prompt, full_notes, scene, model
                )
                futures[future] = (ep_id, scene.get("scene_id", "unknown"))

        # Collect results
        storyboards = {}  # (ep_id, scene_id) -> [shots]
        for future in as_completed(futures):
            ep_id, scene_id = futures[future]
            try:
                shots = future.result()
                storyboards[(ep_id, scene_id)] = shots
                print(f"  OK {ep_id}/{scene_id}: {len(shots)} shots")
            except Exception as e:
                print(f"  FAIL {ep_id}/{scene_id}: {e}", file=sys.stderr)
                storyboards[(ep_id, scene_id)] = []

    # Write draft storyboard JSONs. Do not mutate script.json; storyboard is a
    # director artifact that must be reviewed/approved before VIDEO consumes it.
    draft_root = output_dir / "storyboard" / "draft"
    draft_root.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        ep_id = ep.get("ep_id", "unknown")
        scene_payloads = []
        for scene in ep.get("scenes", []):
            scene_id = scene.get("scene_id", "unknown")
            shots = storyboards.get((ep_id, scene_id), [])
            scene_payloads.append({
                "scene_id": scene_id,
                "shots": shots,
            })
        sb_path = draft_root / f"{ep_id}_storyboard.json"
        with open(sb_path, "w") as f:
            json.dump(
                {"episode_id": ep_id, "status": "draft", "scenes": scene_payloads},
                f,
                indent=2,
                ensure_ascii=False,
            )
        print(f"  -> {sb_path}")

    elapsed = time.time() - t0
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
        script["episodes"] = [ep for ep in script["episodes"] if ep.get("ep_id") in ep_filter]

    ok, status = generate_all_storyboards(
        project_dir, bible, script,
        dry_run=args.dry_run, concurrency=args.concurrency, model=args.model
    )
    print(f"\n[storyboard] {status}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
