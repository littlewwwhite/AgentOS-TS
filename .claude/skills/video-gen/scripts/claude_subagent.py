#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
claude_subagent.py — Claude CLI sub-agent wrapper

Calls Claude via `claude -p` as a subagent, providing an interface
compatible with Gemini model.generate_content().
Also includes a robust JSON parsing utility.
"""

import json
import re
import subprocess


class _ClaudeResponse:
    """Claude response wrapper compatible with Gemini response interface."""

    def __init__(self, text: str):
        self._text = text
        self.candidates = [True] if text else []
        self.prompt_feedback = None

    @property
    def text(self):
        return self._text


class ClaudeSubagent:
    """Calls Claude as a sub-agent via `claude -p`, maintaining model.generate_content(prompt) interface."""

    def __init__(self, model_name: str = None):
        self.model_name = model_name

    def generate_content(self, contents, safety_settings=None):
        """Compatible with GeminiModel.generate_content() interface.

        Args:
            contents: String or list. If list, text parts are extracted and joined.
                      Note: image objects (PIL.Image) are skipped since claude -p
                      does not support image input.
            safety_settings: Ignored (compatibility interface).
        """
        if isinstance(contents, str):
            prompt = contents
        elif isinstance(contents, list):
            text_parts = [c for c in contents if isinstance(c, str)]
            prompt = "\n".join(text_parts)
        else:
            prompt = str(contents)

        max_retries = 2
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                result = subprocess.run(
                    ['claude', '-p', '--output-format', 'text', '--max-turns', '1'],
                    input=prompt,
                    capture_output=True,
                    text=True,
                    timeout=360
                )

                if result.returncode != 0:
                    error_msg = result.stderr.strip() if result.stderr else f"exit code {result.returncode}"
                    raise RuntimeError(f"Claude subagent call failed: {error_msg}")

                response_text = result.stdout.strip()
                if not response_text:
                    raise RuntimeError("Claude subagent returned empty response")

                return _ClaudeResponse(response_text)

            except subprocess.TimeoutExpired:
                last_error = RuntimeError(f"Claude subagent timed out (360s), attempt {attempt}")
                print(f"  [WARN] subagent timeout, attempt {attempt}/{max_retries}")
            except RuntimeError as e:
                last_error = e
                if "empty response" in str(e) and attempt < max_retries:
                    print(f"  [WARN] subagent returned empty response, attempt {attempt}/{max_retries}, retrying...")
                else:
                    raise
            except FileNotFoundError:
                raise RuntimeError("claude command not found, please ensure Claude Code CLI is installed")

        raise last_error


def safe_json_loads(text: str):
    """Robust JSON parsing: auto-repairs common formatting issues in Claude output.

    Repair priority:
    1. Direct parse
    2. Extract from markdown code block, then parse
    3. Extract outermost [...] / {...} structure, then parse
    4. Replace bare control characters (newlines, tabs), then parse
    5. Use json_repair library if installed
    """
    text = text.strip()
    if not text:
        raise ValueError("empty response")

    # 1. Direct attempt
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Extract from markdown code block
    m = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if m:
        candidate = m.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            text = candidate  # continue repairing the extracted content

    # 3. Extract outermost structure
    for open_c, close_c in [('[', ']'), ('{', '}')]:
        start = text.find(open_c)
        if start == -1:
            continue
        end = text.rfind(close_c)
        if end > start:
            candidate = text[start:end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                text = candidate
                break

    # 4. Replace bare control characters
    fixed = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # 5. json_repair
    try:
        import json_repair  # type: ignore
        result = json_repair.loads(text)
        if result is not None:
            return result
    except Exception:
        pass

    # All strategies failed, raise the original error
    return json.loads(text)
