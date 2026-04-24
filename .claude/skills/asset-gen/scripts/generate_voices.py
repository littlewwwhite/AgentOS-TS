#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: character voice request metadata
# output: no generated voice; compatibility tuple for callers
# pos: voice generation is disabled until a non-platform-specific provider is added

from __future__ import annotations

import json
import sys


def generate_voice_for_char(item: dict) -> tuple:
    actor_id = item.get("actor_id")
    actor_name = item.get("actor_name") or item.get("name") or actor_id
    print(f"voice generation disabled for {actor_name}; skipping", file=sys.stderr)
    return actor_id, None, None


def main() -> int:
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    actor_id, voice_path, voice_url = generate_voice_for_char(payload)
    print(json.dumps({"actor_id": actor_id, "voice_path": voice_path, "voice_url": voice_url}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
