#!/usr/bin/env python3
"""
autoresearch_skill.py — Autonomous skill optimization loop.

Mirrors Karpathy's autoresearch architecture:
  program.md  → evaluation rubric (judge prompt, locked)
  train.py    → SKILL.md body (the ONE modifiable file)
  prepare.py  → references/ + scripts/ (locked, read-only)
  val_bpb     → weighted score from multi-dimension rubric

Usage:
    # Set API keys in .env or environment
    export ANTHROPIC_API_KEY=...

    # Run optimization loop
    python3 scripts/autoresearch_skill.py \\
        --skill agents/screenwriter/.claude/skills/script-adapt \\
        --test-dir scripts/autoresearch-fixtures/screenwriter \\
        --rounds 5

    # Dry-run: evaluate current skill without modifying
    python3 scripts/autoresearch_skill.py \\
        --skill agents/screenwriter/.claude/skills/script-adapt \\
        --test-dir scripts/autoresearch-fixtures/screenwriter \\
        --evaluate-only
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Load .env if present
# ---------------------------------------------------------------------------
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

import anthropic  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
RUNNER_MODEL = "claude-sonnet-4-6"  # runs the skill (cheap, fast)
JUDGE_MODEL = "claude-sonnet-4-6"  # evaluates output
IMPROVER_MODEL = "claude-sonnet-4-6"  # modifies SKILL.md
MAX_TOKENS_RUN = 8192
MAX_TOKENS_JUDGE = 8192
MAX_TOKENS_IMPROVE = 16384
ACCEPT_THRESHOLD = 0.3  # minimum improvement to keep a change


@dataclass
class SkillContext:
    """Loaded skill: body (modifiable) + references (locked)."""

    skill_dir: Path
    skill_md: str = ""
    references: dict[str, str] = field(default_factory=dict)

    def load(self) -> "SkillContext":
        self.skill_md = (self.skill_dir / "SKILL.md").read_text()
        refs_dir = self.skill_dir / "references"
        self.references = {}
        if refs_dir.is_dir():
            for f in sorted(refs_dir.iterdir()):
                if f.is_file() and f.suffix == ".md":
                    self.references[f.name] = f.read_text()
        return self

    def save_skill(self, new_content: str) -> None:
        (self.skill_dir / "SKILL.md").write_text(new_content)
        self.skill_md = new_content

    def assemble_system_prompt(self) -> str:
        """Build the full system prompt as the SDK would."""
        # Try loading agent-level CLAUDE.md (two levels up from skill dir)
        agent_claude = ""
        agent_dir = self.skill_dir.parent.parent.parent  # skills/<name> → .claude → agent_dir
        claude_md = agent_dir / ".claude" / "CLAUDE.md"
        if claude_md.exists():
            agent_claude = claude_md.read_text()

        parts = []
        if agent_claude:
            parts.append("# Agent Role")
            parts.append(agent_claude)
            parts.append("")
        parts.append("# Skill Instructions")
        parts.append("Follow the skill instructions below EXACTLY.")
        parts.append("")
        parts.append(self.skill_md)
        for name, content in self.references.items():
            parts.append(f"\n# Reference: {name}\n")
            parts.append(content)
        return "\n".join(parts)


@dataclass
class TestCase:
    """A test case: input prompt + optional pre-built context files."""

    name: str
    user_prompt: str
    context_files: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load_dir(cls, test_dir: Path) -> list["TestCase"]:
        cases = []
        for case_dir in sorted(test_dir.iterdir()):
            if not case_dir.is_dir():
                continue
            prompt_file = case_dir / "prompt.md"
            if not prompt_file.exists():
                continue
            context = {}
            for f in sorted(case_dir.iterdir()):
                if f.is_file() and f.name != "prompt.md":
                    context[f.name] = f.read_text()
            cases.append(cls(
                name=case_dir.name,
                user_prompt=prompt_file.read_text(),
                context_files=context,
            ))
        return cases

    def build_user_message(self) -> str:
        parts = [self.user_prompt]
        for name, content in self.context_files.items():
            parts.append(f"\n--- {name} ---\n{content}")
        return "\n".join(parts)


# ---------------------------------------------------------------------------
# Judge prompt (the "program.md" — locked, defines evaluation criteria)
# ---------------------------------------------------------------------------
JUDGE_PROMPT = """\
You are a professional script quality evaluator for short-form animated drama.
Evaluate the script against 8 dimensions. Be strict and evidence-based.

## Rules (abbreviated)
- Episode = 60s (±5s) = 17-22 action points. 1 action point ≈ 3 seconds.
- Dialogue: 8-14 chars per sentence.
- Action lines: ≤5 action points per line (→ separated).
- Opening: first second must be explosive (no establishing shots, no 空镜).
- Twist density: ≥1 per 15 seconds.
- Forbidden words: 不禁, 竟然, 缓缓, 默默, 渐渐, 猛地, 忽然, 蓦地, 微微, 淡淡, 轻轻
- Forbidden patterns: "XX的眼中闪过一丝XX", "XX的嘴角微微上扬", repeated same-action words
- Every dialogue must have preceding ▲ action line (有白必有画).
- Camera test: ▲ lines must describe camera-visible content only.
- Time-space coupling: dialogue_chars ≤ adjacent_action_points × 9

## Dimensions (weights)
D1: 时长合规 (0.15) — count ▲ lines' → separated phrases, sum per episode, target 17-22
D2: 对白质量 (0.15) — sentence length 8-14 chars, function tags ≥2 types/scene
D3: 画面可执行性 (0.15) — 有白必有画, ≤5 pts/line, camera test pass
D4: 节奏控制 (0.15) — 0-frame opening, twist ≥1/15s, 60s arc structure
D5: 去AI味 (0.10) — zero forbidden words/patterns, no repetition
D6: 角色区分度 (0.10) — unique voice per character (blind test)
D7: 格式规范 (0.10) — scene header, 人物行, correct ▲ syntax
D8: 集间衔接 (0.10) — cliffhanger→hook causal link

## Scoring
Each dimension: 1-10 with specific evidence (cite lines).
weighted_total = sum(score × weight).

## Output: VALID JSON ONLY (no markdown fences)
{
  "dimensions": {
    "D1_duration": {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D2_dialogue": {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D3_visual":   {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D4_pacing":   {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D5_deai":     {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D6_character": {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D7_format":   {"score": N, "evidence": ["..."], "issues": ["..."]},
    "D8_continuity": {"score": N, "evidence": ["..."], "issues": ["..."]}
  },
  "weighted_total": N,
  "top3_issues": ["...", "...", "..."],
  "improvement_suggestion": "What to change in SKILL.md body to fix top issues"
}
"""

IMPROVER_PROMPT = """\
You are optimizing a screenwriting skill (SKILL.md) for an AI agent.
Your ONLY job: make TARGETED modifications to improve the evaluation score.

## CRITICAL CONSTRAINTS
- Return the COMPLETE SKILL.md (frontmatter + full body). DO NOT truncate or summarize.
- The output MUST be at least 90% the length of the input SKILL.md.
- Do NOT delete sections. Only ADD enforcement language or MODIFY existing wording.
- Do NOT rewrite from scratch. Make surgical edits (≤5 specific changes per round).
- Preserve ALL existing structure: headers, code blocks, tables, lists.

## Strategy
The rules in references/ are already comprehensive. Common effective fixes:
1. Change "建议" (suggest) to "必须" (must) with quantitative pass/fail criteria
2. Add "write → count → verify → rewrite if fail" loops
3. Add concrete negative examples to existing rules
4. Strengthen existing enforcement gates with stricter thresholds

## Output
Return the COMPLETE modified SKILL.md. Mark each change with <!-- CHANGED: reason -->.
"""


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
def create_client() -> anthropic.Anthropic:
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return anthropic.Anthropic(**kwargs)


def llm_call(
    client: Any,
    system: str,
    user: str,
    model: str,
    max_tokens: int,
    provider: str = "anthropic",
) -> str:
    max_retries = 3
    for attempt in range(max_retries):
        try:
            if provider == "gemini":
                return _gemini_call(system, user, model, max_tokens)
            resp = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return resp.content[0].text
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/{max_retries} after {wait}s: {e}", flush=True)
                time.sleep(wait)
            else:
                raise


def _gemini_call(system: str, user: str, model: str, max_tokens: int) -> str:
    """Fallback: use Google Gemini API."""
    import google.generativeai as genai  # noqa: E402

    api_key = os.environ.get("GEMINI_API_KEY")
    base_url = os.environ.get("GEMINI_BASE_URL")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    if base_url:
        genai.configure(api_key=api_key, transport="rest", client_options={"api_endpoint": base_url})
    else:
        genai.configure(api_key=api_key)
    gm = genai.GenerativeModel(model, system_instruction=system)
    resp = gm.generate_content(
        user,
        generation_config=genai.GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=0,  # deterministic output for reproducible scoring
        ),
    )
    return resp.text


def extract_json(text: str) -> dict:
    """Extract JSON from LLM output, handling markdown fences."""
    # Try direct parse first
    text = text.strip()
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    # Try extracting from code fence
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Last resort: find first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    # Truncated JSON repair: try closing open braces/brackets
    if start != -1:
        fragment = text[start:]
        for suffix in ["}", "]}", "\"]}}", "\"]}}}"]:
            try:
                return json.loads(fragment + suffix)
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not extract JSON from response:\n{text[:500]}")


# ---------------------------------------------------------------------------
# Rule-based scoring (zero noise, zero API cost for D1/D2/D5)
# ---------------------------------------------------------------------------
FORBIDDEN_WORDS = ["不禁", "竟然", "缓缓", "默默", "渐渐", "猛地", "忽然", "蓦地", "微微", "淡淡", "轻轻"]


def rule_based_scores(script: str) -> dict:
    """Compute D1/D2/D5 deterministically from script text."""
    lines = script.split("\n")

    # D1: count action points (▲ lines, → separated)
    total_action_points = 0
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("▲"):
            total_action_points += stripped.count("→") + 1
    # Assume 2 episodes, so ~17-22 per ep → 34-44 total
    per_ep = total_action_points / max(1, _count_episodes(script))
    if 17 <= per_ep <= 22:
        d1 = 10
    elif 15 <= per_ep <= 24:
        d1 = 8
    elif 12 <= per_ep <= 27:
        d1 = 6
    else:
        d1 = max(1, 10 - abs(per_ep - 20))

    # D2: dialogue length distribution
    dialogues = []
    for line in lines:
        stripped = line.strip()
        # Match dialogue: 角色名（...）：text  or  角色名：text
        if "：" in stripped and not stripped.startswith("▲") and not stripped.startswith("【"):
            colon_pos = stripped.index("：")
            text = stripped[colon_pos + 1:].strip()
            # Remove punctuation for char count
            clean = re.sub(r'[。！？…、，；：\u201c\u201d\u2018\u2019（）.!?,;:\s]', '', text)
            if clean:
                dialogues.append(len(clean))
    if dialogues:
        in_range = sum(1 for d in dialogues if 8 <= d <= 14) / len(dialogues)
        d2 = min(10, max(1, int(in_range * 10)))
    else:
        d2 = 5

    # D5: forbidden word count
    hits = sum(script.count(w) for w in FORBIDDEN_WORDS)
    # Also check forbidden patterns
    patterns = [r'.的眼中闪过一丝.', r'.的嘴角微微上扬']
    for pat in patterns:
        hits += len(re.findall(pat, script))
    d5 = max(1, 10 - hits * 2)

    return {"D1_duration": d1, "D2_dialogue": d2, "D5_deai": d5}


def _count_episodes(script: str) -> int:
    """Count episodes by scene headers like 1-1, 2-1, etc."""
    eps = set()
    for match in re.finditer(r'^(\d+)-\d+', script, re.MULTILINE):
        eps.add(match.group(1))
    return max(1, len(eps))


# ---------------------------------------------------------------------------
# Core loop steps
# ---------------------------------------------------------------------------
def run_skill(
    client: Any,
    ctx: SkillContext,
    case: TestCase,
    provider: str = "anthropic",
) -> str:
    """Run the skill on a test case, return generated script."""
    system = ctx.assemble_system_prompt()
    user_msg = case.build_user_message()
    print(f"  Running skill on '{case.name}'...", flush=True)
    t0 = time.time()
    result = llm_call(client, system, user_msg, RUNNER_MODEL, MAX_TOKENS_RUN, provider=provider)
    dt = time.time() - t0
    print(f"  Done ({dt:.1f}s, {len(result)} chars)")
    return result


def judge_output(
    client: Any,
    script_output: str,
    provider: str = "anthropic",
) -> dict:
    """Evaluate a script output using hybrid: rule-based (D1/D2/D5) + LLM (rest)."""
    # Rule-based scores (deterministic, zero cost)
    rule_scores = rule_based_scores(script_output)
    print(f"  Rule scores: D1={rule_scores['D1_duration']} D2={rule_scores['D2_dialogue']} D5={rule_scores['D5_deai']}", flush=True)

    # LLM scores (D3/D4/D6/D7/D8)
    print("  Judging output (LLM)...", flush=True)
    t0 = time.time()
    raw = llm_call(client, JUDGE_PROMPT, script_output, JUDGE_MODEL, MAX_TOKENS_JUDGE, provider=provider)
    dt = time.time() - t0
    llm_scores = extract_json(raw)

    # Merge: rule-based overrides LLM for D1/D2/D5
    dims = llm_scores.get("dimensions", {})
    for key, val in rule_scores.items():
        if key in dims:
            dims[key]["score"] = val
            dims[key]["source"] = "rule"
        else:
            dims[key] = {"score": val, "evidence": [], "issues": [], "source": "rule"}

    # Recalculate weighted total
    weights = {
        "D1_duration": 0.15, "D2_dialogue": 0.15, "D3_visual": 0.15,
        "D4_pacing": 0.15, "D5_deai": 0.10, "D6_character": 0.10,
        "D7_format": 0.10, "D8_continuity": 0.10,
    }
    total = sum(dims.get(d, {}).get("score", 5) * w for d, w in weights.items())
    llm_scores["weighted_total"] = round(total, 2)
    llm_scores["dimensions"] = dims

    print(f"  Score: {total:.2f} ({dt:.1f}s)")
    return llm_scores


def improve_skill(
    client: Any,
    ctx: SkillContext,
    judge_results: list[dict],
    provider: str = "anthropic",
) -> str:
    """Generate an improved SKILL.md based on judge feedback."""
    user_msg = (
        f"## Judge Results (averaged across {len(judge_results)} test cases)\n\n"
        + json.dumps(judge_results, ensure_ascii=False, indent=2)
        + f"\n\n## Current SKILL.md\n\n{ctx.skill_md}"
    )
    print("  Generating improved SKILL.md...", flush=True)
    t0 = time.time()
    new_skill = llm_call(client, IMPROVER_PROMPT, user_msg, IMPROVER_MODEL, MAX_TOKENS_IMPROVE, provider=provider)
    dt = time.time() - t0

    # Validate: must contain frontmatter
    if "---" not in new_skill[:50]:
        print(f"  WARNING: Improver output missing frontmatter, keeping original")
        return ctx.skill_md

    # Validate: must not shrink SKILL.md by more than 10%
    min_len = int(len(ctx.skill_md) * 0.9)
    if len(new_skill) < min_len:
        print(f"  WARNING: Improver shrunk SKILL.md too much ({len(new_skill)} < {min_len}), keeping original")
        return ctx.skill_md

    print(f"  Done ({dt:.1f}s, {len(new_skill)} chars)")
    return new_skill


def git_commit(skill_dir: Path, message: str) -> bool:
    """Commit SKILL.md changes."""
    skill_file = skill_dir / "SKILL.md"
    try:
        subprocess.run(
            ["git", "add", str(skill_file)],
            cwd=skill_dir,
            capture_output=True,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "-m", message],
            cwd=skill_dir,
            capture_output=True,
            check=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def git_restore(skill_dir: Path) -> None:
    """Revert SKILL.md to last committed version."""
    skill_file = skill_dir / "SKILL.md"
    subprocess.run(
        ["git", "checkout", "--", str(skill_file)],
        cwd=skill_dir,
        capture_output=True,
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_scores(scores: dict, prefix: str = "") -> None:
    dims = scores.get("dimensions", {})
    weights = {
        "D1_duration": 0.15, "D2_dialogue": 0.15, "D3_visual": 0.15,
        "D4_pacing": 0.15, "D5_deai": 0.10, "D6_character": 0.10,
        "D7_format": 0.10, "D8_continuity": 0.10,
    }
    print(f"{prefix}┌────────────────┬───────┬─────────┐")
    print(f"{prefix}│ Dimension      │ Score │ Wtd     │")
    print(f"{prefix}├────────────────┼───────┼─────────┤")
    for dim, w in weights.items():
        s = dims.get(dim, {}).get("score", 0)
        print(f"{prefix}│ {dim:<14} │ {s:5.1f} │ {s*w:7.3f} │")
    print(f"{prefix}├────────────────┼───────┼─────────┤")
    total = scores.get("weighted_total", 0)
    print(f"{prefix}│ TOTAL          │       │ {total:7.3f} │")
    print(f"{prefix}└────────────────┴───────┴─────────┘")

    top3 = scores.get("top3_issues", [])
    if top3:
        print(f"{prefix}Top issues:")
        for i, issue in enumerate(top3, 1):
            print(f"{prefix}  {i}. {issue}")


def save_log(log_path: Path, history: list[dict]) -> None:
    log_path.write_text(json.dumps(history, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Autonomous skill optimization loop")
    parser.add_argument("--skill", required=True, help="Path to skill directory (contains SKILL.md)")
    parser.add_argument("--test-dir", required=True, help="Path to test cases directory")
    parser.add_argument("--rounds", type=int, default=5, help="Max optimization rounds (default: 5)")
    parser.add_argument("--evaluate-only", action="store_true", help="Just evaluate, don't modify")
    parser.add_argument("--log", default=None, help="Path to save JSON log (default: <skill>/autoresearch-log.json)")
    parser.add_argument("--no-git", action="store_true", help="Skip git commit on accept")
    parser.add_argument("--provider", choices=["anthropic", "gemini"], default="anthropic",
                        help="LLM provider (default: anthropic, fallback: gemini)")
    parser.add_argument("--judge-prompt", default=None,
                        help="Path to custom judge prompt file (default: built-in screenwriter rubric)")
    parser.add_argument("--daemon", action="store_true",
                        help="Daemon mode: restart from best after all rounds, loop forever until target score")
    parser.add_argument("--target", type=float, default=8.5,
                        help="Target score to stop at (default: 8.5)")
    args = parser.parse_args()

    skill_dir = Path(args.skill).resolve()
    test_dir = Path(args.test_dir).resolve()
    log_path = Path(args.log) if args.log else skill_dir / "autoresearch-log.json"

    # Load
    ctx = SkillContext(skill_dir).load()
    cases = TestCase.load_dir(test_dir)
    if not cases:
        print(f"ERROR: No test cases found in {test_dir}", file=sys.stderr)
        print(f"  Expected: {test_dir}/<case_name>/prompt.md", file=sys.stderr)
        sys.exit(1)

    provider = args.provider
    # Override model names for Gemini
    global RUNNER_MODEL, JUDGE_MODEL, IMPROVER_MODEL, JUDGE_PROMPT
    if provider == "gemini":
        RUNNER_MODEL = "gemini-3.1-flash-lite-preview"
        JUDGE_MODEL = "gemini-3.1-flash-lite-preview"
        IMPROVER_MODEL = "gemini-3.1-flash-lite-preview"

    # Load custom judge prompt if provided
    if args.judge_prompt:
        JUDGE_PROMPT = Path(args.judge_prompt).read_text()
        print(f"Custom judge prompt: {args.judge_prompt}")

    print(f"Skill: {skill_dir.name}")
    print(f"Provider: {provider} (models: {RUNNER_MODEL})")
    print(f"SKILL.md: {len(ctx.skill_md)} chars")
    print(f"References: {list(ctx.references.keys())}")
    print(f"Test cases: {[c.name for c in cases]}")
    print(f"Rounds: {args.rounds}")
    print()

    client = create_client() if provider == "anthropic" else None
    history: list[dict] = []
    best_score = 0.0
    best_skill_content = ctx.skill_md  # in-memory best (not relying on git)
    global_round = 0
    target_score = args.target

    epoch = 0
    while True:
        epoch += 1
        if epoch > 1:
            print(f"\n{'#'*60}")
            print(f"DAEMON EPOCH {epoch} — restarting from best ({best_score:.2f})")
            print(f"{'#'*60}\n")

        for round_in_epoch in range(args.rounds):
            global_round += 1
            is_baseline = (global_round == 1)

            print(f"{'='*60}")
            print(f"ROUND {global_round} {'(BASELINE)' if is_baseline else ''}")
            print(f"{'='*60}")

            # --- Run + Judge ---
            round_scores = []
            for case in cases:
                output = run_skill(client, ctx, case, provider=provider)
                scores = judge_output(client, output, provider=provider)
                round_scores.append(scores)

            avg_score = sum(s.get("weighted_total", 0) for s in round_scores) / len(round_scores)
            print(f"\n  Average score: {avg_score:.2f}")
            print_scores(round_scores[0], prefix="  ")

            round_entry = {
                "round": global_round,
                "epoch": epoch,
                "score": avg_score,
                "scores": round_scores,
                "accepted": False,
                "skill_chars": len(ctx.skill_md),
            }

            if is_baseline:
                best_score = avg_score
                best_skill_content = ctx.skill_md
                round_entry["accepted"] = True
                round_entry["action"] = "baseline"
                history.append(round_entry)
                print(f"\n  Baseline established: {best_score:.2f}")

                if args.evaluate_only:
                    print("\n  --evaluate-only: stopping after baseline.")
                    save_log(log_path, history)
                    _print_summary(history, best_score, log_path)
                    return
            else:
                delta = avg_score - best_score
                if delta >= ACCEPT_THRESHOLD:
                    best_score = avg_score
                    best_skill_content = ctx.skill_md
                    round_entry["accepted"] = True
                    round_entry["action"] = "accepted"
                    round_entry["delta"] = delta
                    history.append(round_entry)
                    print(f"\n  ACCEPTED (+{delta:.2f}) — new best: {best_score:.2f}")

                    if not args.no_git:
                        msg = f"autoresearch({skill_dir.name}): round {global_round}, score {best_score:.2f} (+{delta:.2f})"
                        if git_commit(skill_dir, msg):
                            print(f"  Committed: {msg}")
                else:
                    round_entry["action"] = "rejected"
                    round_entry["delta"] = delta
                    history.append(round_entry)
                    print(f"\n  REJECTED (delta={delta:+.2f}, threshold={ACCEPT_THRESHOLD})")
                    ctx.save_skill(best_skill_content)

            # Early stop
            if best_score >= target_score:
                print(f"\n  Target score reached ({best_score:.2f} >= {target_score}). Stopping.")
                save_log(log_path, history)
                _print_summary(history, best_score, log_path)
                return

            # Improve for next round
            if round_in_epoch < args.rounds - 1 and not args.evaluate_only:
                new_skill = improve_skill(client, ctx, round_scores, provider=provider)
                ctx.save_skill(new_skill)
                print(f"  SKILL.md updated ({len(new_skill)} chars)")

            # Save log after each round (crash-safe)
            save_log(log_path, history)
            print()

        # End of epoch
        if not args.daemon:
            break
        # Daemon: reset to best and continue
        ctx.save_skill(best_skill_content)

    _print_summary(history, best_score, log_path)


def _print_summary(history: list[dict], best_score: float, log_path: Path) -> None:
    print(f"\nLog saved to: {log_path}")
    print(f"Final best score: {best_score:.2f}")
    print(f"\n{'='*60}")
    print("OPTIMIZATION SUMMARY")
    print(f"{'='*60}")
    for entry in history:
        r = entry["round"]
        s = entry["score"]
        action = entry["action"]
        delta = entry.get("delta", 0)
        mark = "✅" if entry["accepted"] else "❌"
        print(f"  Round {r}: {s:.2f} {mark} {action} {f'(+{delta:.2f})' if delta else ''}")


if __name__ == "__main__":
    main()
