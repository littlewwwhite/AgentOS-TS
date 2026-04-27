#!/usr/bin/env python3
# input: storyboard prompt with @/{}-form act/loc/prop tokens + flat assets_mapping
# output: prompt rewritten with [图N] markers + ordered list of reference image dicts
# pos: video-gen consumer-side bridge from storyboard tokens to Ark referenceImages[]
"""Subject reference resolver for video-gen.

Storyboard skill v1.4.0 emits prompts that reference characters/locations/props
via `@act_001` / `@loc_002` / `@prp_003` tokens (legacy `{act_001}` form is
also accepted for back-compat). Ark's multi-image binding requires `[图N]`
markers in the prompt that index 1-based into `content[]` reference images.
This module rewrites the tokens and assembles the ordered reference list.
"""

import re
from typing import Dict, List, Tuple

# Match @act_001 OR {act_001} OR @prp_002 OR {loc_003}; act/loc/prp only.
# Trailing `}` is optional so the same regex captures both forms.
_TOKEN_RE = re.compile(r"[@{]((?:act|loc|prp)_\d+)\}?")


def extract_subject_tokens(prompt: str) -> List[str]:
    """Return de-duplicated subject ids in first-occurrence order.

    Args:
        prompt: Storyboard prompt text.

    Returns:
        List of token ids like ["act_001", "loc_002", "prp_003"].
    """
    seen: List[str] = []
    seen_set = set()
    for token in _TOKEN_RE.findall(prompt):
        if token not in seen_set:
            seen.append(token)
            seen_set.add(token)
    return seen


def resolve_subject_tokens(
    prompt: str,
    assets_mapping: Dict[str, Dict],
) -> Tuple[str, List[Dict]]:
    """Rewrite tokens to [图N] and return the matching ordered reference dicts.

    Args:
        prompt: Storyboard prompt text containing @act_xxx / {act_xxx} tokens.
        assets_mapping: Flat dict from load_assets_subject_mapping(), keyed by
            id (act_001, loc_002, prp_003) with entries
            {"subject_id": str, "name": str, "type": str, "image_url": str}.

    Returns:
        Tuple of (rewritten_prompt, ordered_reference_image_dicts).
        - Tokens whose entry is missing or has no image_url are left as-is in
          the prompt and skipped in refs.
        - [图N] is 1-based and matches reference list order.
    """
    tokens = extract_subject_tokens(prompt)
    refs: List[Dict] = []
    token_to_index: Dict[str, int] = {}

    for token in tokens:
        entry = assets_mapping.get(token)
        if not entry:
            continue
        url = entry.get("image_url") or ""
        if not url:
            continue
        refs.append({
            "url": url,
            "name": token,
            "display_name": entry.get("name", token),
            "subject_id": entry.get("subject_id", ""),
            "role": "reference_image",
        })
        token_to_index[token] = len(refs)

    def _replace(match: "re.Match[str]") -> str:
        token = match.group(1)
        idx = token_to_index.get(token)
        if idx is None:
            return match.group(0)
        return f"[图{idx}]"

    rewritten = _TOKEN_RE.sub(_replace, prompt)
    return rewritten, refs


def resolve_subject_tokens_to_names(
    prompt: str,
    assets_mapping: Dict[str, Dict],
) -> str:
    """Rewrite @/{} tokens to human-readable display names with no reference list.

    Use this for clips that submit through Ark's first/last-frame mode, which
    Ark rejects when mixed with `reference_image` items in `content[]`. The
    prompt still needs to name subjects so the model can follow the action;
    the lsi frame anchors their appearance visually.

    Args:
        prompt: Storyboard prompt text with @act_xxx / {act_xxx} tokens.
        assets_mapping: Same shape consumed by `resolve_subject_tokens`.

    Returns:
        Prompt with each known token replaced by its `name`. Unknown tokens
        are left unchanged so missing-mapping bugs surface in the output.
    """

    def _replace(match: "re.Match[str]") -> str:
        token = match.group(1)
        entry = assets_mapping.get(token)
        if not entry:
            return match.group(0)
        return entry.get("name") or token

    return _TOKEN_RE.sub(_replace, prompt)
