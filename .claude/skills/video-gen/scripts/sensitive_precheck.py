#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sensitive_precheck.py — Pre-submission sensitive word checker for video prompts.

Parses replacement rules from SENSITIVE_WORDS.md and provides:
  - precheck_prompt(): detect sensitive words in a prompt
  - auto_replace_prompt(): apply all known replacements, return cleaned prompt

Loaded once at module import; no I/O at call time.
"""

import re
import os
from typing import Optional

# ============================================================
# Load rules from SENSITIVE_WORDS.md at module import
# ============================================================

# Absolute path: <this_file's_dir>/../references/SENSITIVE_WORDS.md
_RULES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "references", "SENSITIVE_WORDS.md"
)

# Each rule is a tuple: (list[original_words], list[replacement_words])
# Replacements are applied left-to-right; we use the first replacement option.
_RULES: list[tuple[list[str], list[str]]] = []

# Flat set of all sensitive words for fast O(n) membership check
_SENSITIVE_WORDS: list[str] = []


def _parse_rules_from_md(path: str) -> None:
    """Parse the Markdown table in SENSITIVE_WORDS.md into _RULES and _SENSITIVE_WORDS."""
    global _RULES, _SENSITIVE_WORDS

    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        # Degrade gracefully: no rules loaded, precheck is a no-op
        return

    rules: list[tuple[list[str], list[str]]] = []
    sensitive: list[str] = []

    # Match Markdown table rows: | original | replacement |
    # Skip header and separator rows (those with only dashes/pipes)
    row_pattern = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|", re.MULTILINE)

    for m in row_pattern.finditer(text):
        left, right = m.group(1).strip(), m.group(2).strip()
        # Skip header row
        if "---" in left or left.lower() in ("original", "原始"):
            continue
        # Split on Chinese enumeration separators (、) or comma
        originals = [w.strip() for w in re.split(r"[、,，]", left) if w.strip()]
        replacements = [w.strip() for w in re.split(r"[、,，]", right) if w.strip()]
        if originals and replacements:
            rules.append((originals, replacements))
            sensitive.extend(originals)

    _RULES = rules
    _SENSITIVE_WORDS = sensitive


_parse_rules_from_md(_RULES_PATH)


# ============================================================
# Public API
# ============================================================

def precheck_prompt(prompt: str) -> tuple[bool, list[str]]:
    """Check prompt for known sensitive words before video submission.

    Performs simple substring matching for each word in the sensitive word list.
    Xianxia-prefixed fantasy terms may still appear; this check covers the
    explicit words listed in SENSITIVE_WORDS.md.

    Args:
        prompt: The full video prompt text.

    Returns:
        (is_safe, found_words) where:
          - is_safe: True if no sensitive words found
          - found_words: list of matched sensitive words (empty when safe)
    """
    found = [w for w in _SENSITIVE_WORDS if w in prompt]
    return (len(found) == 0, found)


def auto_replace_prompt(prompt: str) -> tuple[str, list[tuple[str, str]]]:
    """Apply all known sensitive-word replacements to prompt.

    For each matching sensitive word, replaces it with the first replacement
    option in that rule's replacement list.

    Args:
        prompt: Original prompt text.

    Returns:
        (cleaned_prompt, substitutions) where substitutions is a list of
        (original_word, replacement_word) pairs actually applied.
    """
    result = prompt
    substitutions: list[tuple[str, str]] = []

    for originals, replacements in _RULES:
        replacement = replacements[0]  # use first option
        for word in originals:
            if word in result:
                result = result.replace(word, replacement)
                substitutions.append((word, replacement))

    return result, substitutions


def precheck_and_fix(
    prompt: str, clip_id: Optional[str] = None
) -> tuple[bool, str, list[tuple[str, str]]]:
    """Convenience wrapper: detect, attempt auto-fix, return final prompt and outcome.

    Args:
        prompt: The video prompt text.
        clip_id: Optional clip identifier for log context.

    Returns:
        (can_submit, final_prompt, substitutions) where:
          - can_submit: True if prompt is safe to submit (either clean or fully fixed)
          - final_prompt: Cleaned prompt (same as input when already safe)
          - substitutions: List of (original, replacement) pairs applied
    """
    import sys

    is_safe, found = precheck_prompt(prompt)
    if is_safe:
        return True, prompt, []

    tag = f"[{clip_id}] " if clip_id else ""
    print(
        f"[WARN] {tag}Sensitive words detected: {found}. Attempting auto-replace...",
        file=sys.stderr,
    )

    cleaned, substitutions = auto_replace_prompt(prompt)

    # Re-check after replacement
    still_safe, still_found = precheck_prompt(cleaned)
    if still_safe:
        print(
            f"[INFO] {tag}Auto-replacement applied {len(substitutions)} substitution(s): "
            + ", ".join(f"{o!r} -> {r!r}" for o, r in substitutions),
            file=sys.stderr,
        )
        return True, cleaned, substitutions

    # Residual sensitive words that have no replacement mapping
    print(
        f"[ERROR] {tag}Residual sensitive words after replacement — skipping clip: {still_found}",
        file=sys.stderr,
    )
    return False, cleaned, substitutions
