#!/usr/bin/env python3
"""
Source structure detector - Python port of src/tools/source-structure.ts
Detects episode/chapter boundaries in source.txt and outputs structured JSON.

input: source.txt in project directory
output: draft/source-structure.json with segment metadata
pos: standalone CLI tool for script-adapt skill preprocessing
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Literal, TypedDict

DEFAULT_MAX_CHARS_PER_SEGMENT = 8000
MIN_SEGMENTS = 2
MAX_SEGMENTS = 100
MIN_SEGMENT_LENGTH = 100

# Regex patterns - exact translations from TypeScript
EXPLICIT_MARKER_RE = re.compile(
    r"^[\t ]*(?:[#=]+[\t ]*)?(?:第[\t 0-9０-９一二三四五六七八九十百千零〇两]{1,20}[集话章节幕回卷部篇]|"
    r"(?:EP|Episode|Chapter|Part|Volume|Section|Act)\s*[-#:.]?\s*[0-9０-９]{1,4}|"
    r"(?:序章|序言|楔子|引子|前言|开篇|尾声|终章|后记|番外|完结|大结局)|"
    r"卷[一二三四五六七八九十百0-9０-９]{1,10}|"
    r"[上中下]篇|"
    r"[【「『〖]第[\t 0-9０-９一二三四五六七八九十百千零〇两]{1,20}[集话章节幕回卷部篇][】」』〗])[^\n]*$",
    re.MULTILINE | re.IGNORECASE,
)

NUMBERED_TITLE_RE = re.compile(
    r"^[\t ]*(?:[0-9０-９]{1,4}[\t ]*[.．。、)）]\s*[^\n]{2,100}|"
    r"[（(][0-9０-９]{1,4}[)）]\s*[^\n]{2,100})$",
    re.MULTILINE,
)

STANDALONE_NUMBER_RE = re.compile(r"^[\t ]*([0-9０-９]{1,3})[\t ]*$", re.MULTILINE)

SCENE_MARKER_RE = re.compile(
    r"^[\t ]*(?:第)?(\d{1,3})-(\d{1,3})(?:场)?(?:\s+.{0,100})?$", re.MULTILINE
)

SECTION_HEADING_RE = re.compile(
    r"^[\t ]*[0-9０-９]{1,3}(?:\.[0-9０-９]{1,3}){1,4}\s+[^\n]{2,100}$",
    re.MULTILINE,
)

EPISODE_BOUNDARY_RE = re.compile(
    r"^[\t ]*(?:第[\t 0-9０-９一二三四五六七八九十百千零〇两]{1,20}集|"
    r"(?:EP|Episode)\s*[-#:.]?\s*[0-9０-９]{1,4})[^\n]*$",
    re.MULTILINE | re.IGNORECASE,
)

SCRIPT_LINE_HINT_RE = re.compile(
    r"^(?:【登场人物】|【场景】|人物[：:]|场景[：:]|道具[：:]|状态[：:])",
    re.MULTILINE,
)

EPISODE_SCRIPT_SECTION_HINT_RE = re.compile(
    r"(分集剧本|剧本正文|逐集剧本|episode scripts?)",
    re.IGNORECASE,
)

OUTLINE_SECTION_HINT_RE = re.compile(
    r"(大纲|梗概|outline|synopsis)",
    re.IGNORECASE,
)


SourceStructureStrategy = Literal[
    "explicit_markers",
    "numbered_titles",
    "standalone_numbers",
    "scene_markers",
    "chunk_fallback",
]

SourceStructureMode = Literal["authoritative_segments", "fallback_chunks"]
EpisodePlanningSource = Literal["detected_boundaries", "model_required"]
BoundaryConfidence = Literal["high", "low"]


class SourceSegment(TypedDict):
    segment_id: str
    parent_segment_id: str | None
    title: str
    content: str
    source_episode: int | None
    split_part: int
    split_parts: int
    char_count: int


class QualityMetrics(TypedDict):
    coverage_ratio: float
    continuity_ok: bool
    min_segment_length: int
    total_segments: int


class EpisodePlanning(TypedDict):
    episode_source: EpisodePlanningSource
    recommended_total_episodes: int | None
    boundary_confidence: BoundaryConfidence | None
    rationale: str


class SourceStructure(TypedDict):
    version: Literal[1]
    strategy: SourceStructureStrategy
    source_mode: SourceStructureMode
    quality: QualityMetrics
    planning: EpisodePlanning
    segments: list[SourceSegment]


class RawSegment(TypedDict):
    title: str
    content: str
    sourceEpisode: int | None


class DetectResult(TypedDict):
    project_path: str
    source_path: str
    output_path: str
    structure: SourceStructure


class CandidateBlock(TypedDict):
    kind: str
    heading: str
    text: str


def normalize_text(text: str) -> str:
    """Normalize line endings and trim whitespace."""
    return (text or "").replace("\r\n", "\n").strip()


def convert_fullwidth_digits(value: str) -> str:
    """Convert full-width digits (０-９) to ASCII (0-9)."""
    result = []
    for char in value:
        if "\uff10" <= char <= "\uff19":
            result.append(chr(ord(char) - 0xFF10 + 48))
        else:
            result.append(char)
    return "".join(result)


def extract_episode_number(title: str) -> int | None:
    """Extract episode number from title (Arabic or Chinese numerals)."""
    if not title:
        return None

    # Try Arabic numerals
    normalized = convert_fullwidth_digits(title)
    arabic_match = re.search(
        r"(?:第|EP|Episode|Chapter|Part|Volume|Section|Act)?\s*(\d+)", normalized, re.IGNORECASE
    )
    if arabic_match:
        return int(arabic_match.group(1))

    # Try Chinese numerals
    zh_match = re.search(r"第([一二三四五六七八九十百零〇两]+)[集话章节回幕]", title)
    if not zh_match:
        return None

    numerals = zh_match.group(1)
    digit_map = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }

    if numerals == "十":
        return 10
    if numerals.startswith("十"):
        return 10 + digit_map.get(numerals[1:], 0)
    if numerals.endswith("十"):
        return digit_map.get(numerals[:-1], 0) * 10
    if "十" in numerals:
        parts = numerals.split("十")
        tens = digit_map.get(parts[0], 0)
        ones = digit_map.get(parts[1], 0) if len(parts) > 1 else 0
        return tens * 10 + ones

    return digit_map.get(numerals)


def check_continuity(segments: list[RawSegment]) -> bool:
    """Check if episode numbers form a continuous sequence."""
    numbers = [
        num
        for seg in segments
        if (num := extract_episode_number(seg["title"])) is not None
    ]

    if len(numbers) < len(segments) * 0.8:
        return False

    sorted_nums = sorted(numbers)
    return all(
        i == 0 or sorted_nums[i] == sorted_nums[i - 1] + 1
        for i in range(len(sorted_nums))
    )


def chunk_text_by_newlines(text: str, max_chars: int) -> list[str]:
    """Split text into chunks at natural boundaries (newlines, punctuation)."""
    normalized = normalize_text(text)
    if not normalized:
        return []

    chunks = []
    cursor = 0

    while cursor < len(normalized):
        hard_end = min(len(normalized), cursor + max_chars)
        if hard_end >= len(normalized):
            chunks.append(normalized[cursor:].strip())
            break

        search_start = min(len(normalized), cursor + int(max_chars * 0.6))
        split_at = -1

        for delimiter in ["\n\n", "。\n", "！\n", "？\n", "!\n", "?\n", "\n"]:
            found = normalized.rfind(delimiter, search_start, hard_end + 1)
            if found >= search_start and found > split_at:
                split_at = found + len(delimiter)

        if split_at <= cursor:
            split_at = hard_end

        chunks.append(normalized[cursor:split_at].strip())
        cursor = split_at

    return [chunk for chunk in chunks if chunk]


def build_segments_from_matches(
    matches: list[re.Match], text: str
) -> list[RawSegment]:
    """Build segments from regex match positions."""
    segments = []

    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if not content:
            continue

        title = content.split("\n")[0].strip() or f"Episode {len(segments) + 1}"
        segments.append(
            {
                "title": title,
                "content": content,
                "sourceEpisode": extract_episode_number(title),
            }
        )

    return segments


def count_episode_boundaries(text: str) -> int:
    """Count likely episode boundary markers inside a block."""
    return len(list(EPISODE_BOUNDARY_RE.finditer(text)))


def count_script_line_hints(text: str) -> int:
    """Count lines that look like structured script markup."""
    return len(list(SCRIPT_LINE_HINT_RE.finditer(text)))


def classify_block(heading: str, text: str) -> str:
    """Classify a semantic block to help scoring."""
    if EPISODE_SCRIPT_SECTION_HINT_RE.search(heading):
        return "episode_script_section"
    if OUTLINE_SECTION_HINT_RE.search(heading):
        return "outline_section"
    if count_script_line_hints(text) >= 2 and count_episode_boundaries(text) >= 2:
        return "episode_script_section"
    return "generic_section"


def build_candidate_blocks(text: str) -> list[CandidateBlock]:
    """Build candidate text blocks from full text and numbered section headings."""
    blocks: list[CandidateBlock] = [{"kind": "full_text", "heading": "", "text": text}]
    matches = list(SECTION_HEADING_RE.finditer(text))

    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block_text = text[start:end].strip()
        if len(block_text) < MIN_SEGMENT_LENGTH:
            continue
        heading = match.group(0).strip()
        blocks.append(
            {
                "kind": classify_block(heading, block_text),
                "heading": heading,
                "text": block_text,
            }
        )

    return blocks


def score_candidate_segments(
    strategy: SourceStructureStrategy,
    segments: list[RawSegment],
    candidate_text: str,
    block_kind: str,
) -> float:
    """Score a candidate split; higher is better."""
    if not segments:
        return float("-inf")

    coverage_ratio = compute_coverage_ratio(segments, candidate_text)
    if coverage_ratio < 0.85:
        return float("-inf")

    continuity_ok = check_continuity(segments)
    min_segment_length = min(len(seg["content"]) for seg in segments)
    script_line_hints = count_script_line_hints(candidate_text)
    section_like_titles = sum(
        1 for seg in segments if SECTION_HEADING_RE.match(seg["title"])
    )
    duplicate_episode_count = 0
    source_numbers = [seg["sourceEpisode"] for seg in segments if seg["sourceEpisode"] is not None]
    if source_numbers:
        duplicate_episode_count = len(source_numbers) - len(set(source_numbers))
    internal_episode_markers = sum(
        max(0, count_episode_boundaries(seg["content"]) - 1) for seg in segments
    )

    if not continuity_ok and min_segment_length < MIN_SEGMENT_LENGTH and script_line_hints == 0:
        return float("-inf")

    score = coverage_ratio * 100
    score += min(script_line_hints, 6) * 6
    score += 18 if continuity_ok else 0
    score += 10 if strategy == "explicit_markers" else 0
    score += 8 if strategy == "scene_markers" else 0
    score += 24 if block_kind == "episode_script_section" else 0
    score -= 12 if block_kind == "outline_section" else 0
    score -= section_like_titles * 15
    score -= duplicate_episode_count * 10
    score -= internal_episode_markers * 12
    score -= max(0, len(segments) - 40) * 0.5
    return score


def split_by_explicit_markers(text: str) -> list[RawSegment]:
    """Split by explicit chapter/episode markers."""
    matches = list(EXPLICIT_MARKER_RE.finditer(text))
    if len(matches) < MIN_SEGMENTS or len(matches) > MAX_SEGMENTS:
        return []
    return build_segments_from_matches(matches, text)


def split_by_numbered_titles(text: str) -> list[RawSegment]:
    """Split by numbered title lines (e.g., '1. Title')."""
    matches = list(NUMBERED_TITLE_RE.finditer(text))
    if len(matches) < MIN_SEGMENTS or len(matches) > MAX_SEGMENTS:
        return []
    return build_segments_from_matches(matches, text)


def find_best_sequential_number_run(numbers: list[int]) -> tuple[int, int] | None:
    """Find the longest sequential run, preferring earlier runs on ties."""
    if len(numbers) < MIN_SEGMENTS:
        return None

    best_range: tuple[int, int] | None = None
    run_start = 0

    for index in range(1, len(numbers) + 1):
        at_end = index == len(numbers)
        continues = not at_end and numbers[index] == numbers[index - 1] + 1
        if continues:
            continue

        run_length = index - run_start
        if numbers[run_start] <= 10 and run_length >= MIN_SEGMENTS:
            if best_range is None or run_length > (best_range[1] - best_range[0]):
                best_range = (run_start, index)

        run_start = index

    return best_range


def split_by_standalone_numbers(text: str) -> list[RawSegment]:
    """Split by standalone sequential numbers on their own lines."""
    matches = list(STANDALONE_NUMBER_RE.finditer(text))
    if len(matches) < MIN_SEGMENTS or len(matches) > MAX_SEGMENTS:
        return []

    numbers = [int(convert_fullwidth_digits(m.group(1))) for m in matches]
    best_run = find_best_sequential_number_run(numbers)
    if best_run is None:
        return []
    run_start, run_end = best_run
    run_matches = matches[run_start:run_end]
    run_numbers = numbers[run_start:run_end]

    segments = []
    for i, match in enumerate(run_matches):
        start = match.start()
        end = run_matches[i + 1].start() if i + 1 < len(run_matches) else len(text)
        content = text[start:end].strip()
        if not content:
            continue

        lines = content.split("\n")
        suffix = f" {lines[1].strip()[:30]}" if len(lines) > 1 and lines[1].strip() else ""
        segments.append(
            {
                "title": f"第{run_numbers[i]}集{suffix}",
                "content": content,
                "sourceEpisode": run_numbers[i],
            }
        )

    return segments


def split_by_scene_markers(text: str) -> list[RawSegment]:
    """Split by scene markers (e.g., '1-1', '1-2')."""
    matches = list(SCENE_MARKER_RE.finditer(text))
    if len(matches) < 3:
        return []

    episode_starts = {}
    for match in matches:
        episode = int(match.group(1))
        if episode not in episode_starts:
            episode_starts[episode] = match.start()

    ordered = sorted(episode_starts.items(), key=lambda x: x[1])
    segments = []
    for i, (episode, start) in enumerate(ordered):
        end = ordered[i + 1][1] if i + 1 < len(ordered) else len(text)
        content = text[start:end].strip()
        if content:
            segments.append(
                {
                    "title": f"Episode {episode}",
                    "content": content,
                    "sourceEpisode": episode,
                }
            )

    return segments


def fallback_chunks(text: str, max_chars_per_segment: int) -> list[RawSegment]:
    """Fallback: split into equal-sized chunks."""
    chunks = chunk_text_by_newlines(text, max_chars_per_segment)
    return [
        {
            "title": f"Chunk {i + 1}",
            "content": content,
            "sourceEpisode": i + 1,
        }
        for i, content in enumerate(chunks)
    ]


def compute_coverage_ratio(segments: list[RawSegment], text: str) -> float:
    """Calculate what fraction of original text is covered by segments."""
    if not text:
        return 0.0
    total_chars = sum(len(seg["content"]) for seg in segments)
    return total_chars / len(text)


def select_segments(
    text: str, max_chars_per_segment: int
) -> tuple[SourceStructureStrategy, SourceStructureMode, list[RawSegment], BoundaryConfidence]:
    """Try all strategies and select the best one.

    Fast path: explicit markers on full text with good continuity and coverage
    are accepted immediately — they represent clear chapter/episode boundaries
    that should never be overridden by section-heading-based splits.

    Confidence semantics:
    - "high": found genuine 第N集/Episode N markers → downstream may trust count
    - "low":  found numbered section headings or scene markers, not episode chapters
              → downstream must use model judgment for total_episodes
    """
    # Fast path: explicit markers on full text
    full_text_explicit = split_by_explicit_markers(text)
    if (
        full_text_explicit
        and MIN_SEGMENTS <= len(full_text_explicit) <= MAX_SEGMENTS
        and check_continuity(full_text_explicit)
        and compute_coverage_ratio(full_text_explicit, text) >= 0.85
    ):
        return "explicit_markers", "authoritative_segments", full_text_explicit, "high"

    # General path: score all strategies on all candidate blocks
    best_score = float("-inf")
    best_candidate: tuple[SourceStructureStrategy, list[RawSegment]] | None = None

    for block in build_candidate_blocks(text):
        candidates: list[tuple[SourceStructureStrategy, list[RawSegment]]] = [
            ("explicit_markers", split_by_explicit_markers(block["text"])),
            ("numbered_titles", split_by_numbered_titles(block["text"])),
            ("standalone_numbers", split_by_standalone_numbers(block["text"])),
            ("scene_markers", split_by_scene_markers(block["text"])),
        ]

        for strategy, segments in candidates:
            if not segments:
                continue
            if not (MIN_SEGMENTS <= len(segments) <= MAX_SEGMENTS):
                continue

            score = score_candidate_segments(
                strategy,
                segments,
                block["text"],
                block["kind"],
            )
            if score > best_score:
                best_score = score
                best_candidate = (strategy, segments)

    if best_candidate is not None:
        strategy, segments = best_candidate
        # Only explicit episode markers earn high confidence; all other heuristics
        # (numbered section headings, scene markers, etc.) are unreliable as
        # episode-count indicators and must not override model judgment.
        confidence: BoundaryConfidence = "high" if strategy == "explicit_markers" else "low"
        return strategy, "authoritative_segments", segments, confidence

    return (
        "chunk_fallback",
        "fallback_chunks",
        fallback_chunks(text, max_chars_per_segment),
        "low",
    )


def expand_segments(
    segments: list[RawSegment], max_chars_per_segment: int
) -> list[SourceSegment]:
    """Expand segments, splitting long ones into parts."""
    expanded = []

    for i, segment in enumerate(segments):
        root_id = f"seg_{str(i + 1).zfill(3)}"
        chunks = (
            chunk_text_by_newlines(segment["content"], max_chars_per_segment)
            if len(segment["content"]) > max_chars_per_segment
            else [segment["content"]]
        )

        for part_idx, content in enumerate(chunks):
            expanded.append(
                {
                    "segment_id": root_id if len(chunks) == 1 else f"{root_id}_p{part_idx + 1}",
                    "parent_segment_id": None if len(chunks) == 1 else root_id,
                    "title": (
                        segment["title"]
                        if len(chunks) == 1
                        else f"{segment['title']} (Part {part_idx + 1})"
                    ),
                    "content": content,
                    "source_episode": segment["sourceEpisode"],
                    "split_part": part_idx + 1,
                    "split_parts": len(chunks),
                    "char_count": len(content),
                }
            )

    return expanded


def detect_source_structure_from_text(
    text: str, max_chars_per_segment: int = DEFAULT_MAX_CHARS_PER_SEGMENT
) -> SourceStructure:
    """Main detection logic - analyze text and return structured result."""
    normalized = normalize_text(text)
    strategy, source_mode, raw_segments, boundary_confidence = select_segments(
        normalized, max_chars_per_segment
    )
    segments = expand_segments(raw_segments, max_chars_per_segment)
    planning: EpisodePlanning

    if source_mode == "authoritative_segments" and boundary_confidence == "high":
        # Only genuine 第N集/Episode N markers earn authority over episode count.
        planning = {
            "episode_source": "detected_boundaries",
            "recommended_total_episodes": len(raw_segments),
            "boundary_confidence": "high",
            "rationale": (
                "Detected explicit episode markers (第N集 / Episode N); "
                "use recommended_total_episodes as the authoritative episode count."
            ),
        }
    elif source_mode == "authoritative_segments":
        # Heuristic boundaries found (section headings, scene markers, numbered items)
        # but they are NOT reliable episode-count indicators — downgrade to model_required.
        planning = {
            "episode_source": "model_required",
            "recommended_total_episodes": None,
            "boundary_confidence": "low",
            "rationale": (
                "Detected numbered section headings or scene markers, not explicit episode markers. "
                "Segment count is unreliable as an episode count; model should decide total_episodes."
            ),
        }
    else:
        planning = {
            "episode_source": "model_required",
            "recommended_total_episodes": None,
            "boundary_confidence": "low",
            "rationale": (
                "Only fallback chunks available; let the model decide episodes "
                "unless the user provided a target."
            ),
        }

    return {
        "version": 1,
        "strategy": strategy,
        "source_mode": source_mode,
        "quality": {
            "coverage_ratio": round(
                compute_coverage_ratio(raw_segments, normalized), 4
            ),
            "continuity_ok": check_continuity(raw_segments),
            "min_segment_length": (
                min(seg["char_count"] for seg in segments) if segments else 0
            ),
            "total_segments": len(segments),
        },
        "planning": planning,
        "segments": segments,
    }


def detect_source_structure_project(
    project_path: str, max_chars_per_segment: int = DEFAULT_MAX_CHARS_PER_SEGMENT
) -> DetectResult:
    """CLI entry point - read source.txt, write draft/source-structure.json."""
    project_dir = Path(project_path).resolve()
    source_path = project_dir / "source.txt"
    output_path = project_dir / "draft" / "source-structure.json"

    text = source_path.read_text(encoding="utf-8")
    structure = detect_source_structure_from_text(text, max_chars_per_segment)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(structure, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "project_path": str(project_dir),
        "source_path": str(source_path),
        "output_path": str(output_path),
        "structure": structure,
    }


def main() -> None:
    """CLI interface."""
    parser = argparse.ArgumentParser(
        description="Detect source structure from source.txt and output JSON"
    )
    parser.add_argument(
        "--project-path",
        required=True,
        help="Path to project directory containing source.txt",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=DEFAULT_MAX_CHARS_PER_SEGMENT,
        help=f"Maximum characters per segment (default: {DEFAULT_MAX_CHARS_PER_SEGMENT})",
    )

    args = parser.parse_args()

    try:
        result = detect_source_structure_project(args.project_path, args.max_chars)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except FileNotFoundError as e:
        print(json.dumps({"error": f"File not found: {e}"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
