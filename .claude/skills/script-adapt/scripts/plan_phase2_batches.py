#!/usr/bin/env python3
"""
Plan Phase 2 episode batches for parallel agent writing.

input: project_path containing draft/design.json and draft/source-structure.json
output: JSON with grouped batches; writes per-group source pack files from detected segments
pos: deterministic helper for Phase B agent dispatching — reads segments from source-structure.json
"""

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_design(project_path: Path) -> Dict[str, Any]:
    design_path = project_path / "draft" / "design.json"
    with open(design_path, "r", encoding="utf-8") as f:
        return json.load(f)


def scan_completed_episodes(project_path: Path) -> List[int]:
    episodes_dir = project_path / "draft" / "episodes"
    if not episodes_dir.exists():
        return []

    completed: List[int] = []
    for file_path in episodes_dir.iterdir():
        if not file_path.is_file():
            continue
        match = re.match(r"^ep(\d+)\.md$", file_path.name, re.IGNORECASE)
        if match:
            completed.append(int(match.group(1)))
    return sorted(set(completed))


# Matches 第N集 and Episode N / EP N headers used as episode boundaries.
_DIRECT_EPISODE_RE = re.compile(
    r"^[\t ]*(?:[#=]+[\t ]*)?(?:第[\t 0-9]{1,20}集|"
    r"(?:EP|Episode)\s*[-#:.]?\s*[0-9]{1,4})[^\n]*$",
    re.MULTILINE | re.IGNORECASE,
)


def _extract_ep_num(header_line: str) -> Optional[int]:
    """Extract episode number from a 第N集 or Episode N header line."""
    m = re.search(r"第\s*([0-9]{1,4})\s*集", header_line)
    if m:
        return int(m.group(1))
    m = re.search(r"(?:EP|Episode)\s*[-#:.]?\s*([0-9]{1,4})", header_line, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def _scan_source_for_episode_map(project_path: Path) -> Optional[Dict[int, str]]:
    """Scan source.txt directly for explicit 第N集/Episode N markers.

    Returns episode_map if at least 2 markers found, else None.
    """
    source_path = project_path / "source.txt"
    if not source_path.exists():
        return None

    text = source_path.read_text(encoding="utf-8")
    matches = list(_DIRECT_EPISODE_RE.finditer(text))
    if len(matches) < 2:
        return None

    episode_map: Dict[int, str] = {}
    for i, match in enumerate(matches):
        ep_num = _extract_ep_num(match.group())
        if ep_num is None:
            continue
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if content:
            episode_map[ep_num] = content

    return episode_map if episode_map else None


def load_episode_map(project_path: Path) -> Optional[Dict[int, str]]:
    """Build episode_map: episode number -> source text.

    Strategy:
    1. Use source-structure.json segments only when boundary_confidence == "high"
       (i.e. genuine 第N集/Episode N markers were found by the detector).
    2. Otherwise fall back to direct source.txt scan for explicit episode headers.
    3. Return None if neither method yields a usable map.
    """
    structure_path = project_path / "draft" / "source-structure.json"
    if structure_path.exists():
        with open(structure_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        planning = data.get("planning", {})
        confidence = planning.get("boundary_confidence")

        if (
            confidence == "high"
            and data.get("source_mode") == "authoritative_segments"
        ):
            segments = data.get("segments", [])
            episode_map: Dict[int, str] = {}
            for seg in segments:
                ep = seg.get("source_episode")
                content = seg.get("content", "")
                if not isinstance(ep, int) or ep <= 0 or not content:
                    continue
                if ep in episode_map:
                    episode_map[ep] += "\n\n" + content
                else:
                    episode_map[ep] = content
            if episode_map:
                return episode_map

    # Segment-based mapping unavailable or unreliable — scan source.txt directly.
    return _scan_source_for_episode_map(project_path)


def write_source_pack(
    project_path: Path,
    group_index: int,
    episodes: List[int],
    episode_map: Dict[int, str],
) -> str:
    """Write a per-group source pack markdown file. Returns the file path."""
    packs_dir = project_path / "draft" / "source_packs"
    packs_dir.mkdir(parents=True, exist_ok=True)

    pack_path = packs_dir / f"group_{group_index + 1}.md"
    parts: List[str] = []
    for ep in episodes:
        text = episode_map.get(ep, "")
        parts.append(f"## Episode {ep}\n\n{text}")

    pack_path.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    return str(pack_path)


def chunk_pending_episodes(
    pending_episodes: List[int],
    episodes_per_group: int,
    max_groups: int,
) -> List[List[int]]:
    groups = [
        pending_episodes[i : i + episodes_per_group]
        for i in range(0, len(pending_episodes), episodes_per_group)
    ]
    return groups[:max_groups]


def plan_phase2_batches(
    project_path: Path,
    episodes_per_group: int = 2,
    max_groups: int = 10,
) -> Dict[str, Any]:
    design = load_design(project_path)
    total_episodes = design.get("total_episodes")
    if not isinstance(total_episodes, int) or total_episodes <= 0:
        raise ValueError("Invalid total_episodes in design.json")

    completed_episodes = scan_completed_episodes(project_path)
    pending_episodes = [
        ep for ep in range(1, total_episodes + 1)
        if ep not in set(completed_episodes)
    ]
    raw_groups = chunk_pending_episodes(pending_episodes, episodes_per_group, max_groups)

    episode_map = load_episode_map(project_path)
    has_source_mapping = episode_map is not None

    groups = []
    for i, eps in enumerate(raw_groups):
        pack_path: Optional[str] = None
        if episode_map is not None:
            pack_path = write_source_pack(project_path, i, eps, episode_map)

        groups.append({
            "episodes": eps,
            "source_pack_path": pack_path,
        })

    return {
        "project_path": str(project_path),
        "total_episodes": total_episodes,
        "completed_episodes": completed_episodes,
        "pending_episodes": pending_episodes,
        "groups": groups,
        "should_spawn_agents": len(raw_groups) > 1,
        "has_source_mapping": has_source_mapping,
        "episodes_per_group": episodes_per_group,
        "max_groups": max_groups,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Plan Phase 2 batches for parallel agent writing")
    parser.add_argument("--project-path", required=True, help="Path to workspace or draft project directory")
    parser.add_argument("--episodes-per-group", type=int, default=2, help="Episodes per parallel worker group")
    parser.add_argument("--max-groups", type=int, default=10, help="Maximum number of parallel groups")
    args = parser.parse_args()

    result = plan_phase2_batches(
        Path(args.project_path),
        episodes_per_group=args.episodes_per_group,
        max_groups=args.max_groups,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
