#!/usr/bin/env python3
# input: draft/episodes/ep*.md + draft/catalog.json
# output: normalized ep*.md in-place + JSON report to stdout
# pos: deterministic format normalizer between Phase 2 and Phase 3

"""Fix common LLM format deviations in episode files.

Auto-fix rules:
  R1  Strip compound names: Name(alias) -> Name  (actors + props)
  R2  Fix 人物 line separators: comma -> 、
  R3  Fix episode header: 第7集 Title -> 第7集：Title
  R4  Remove blank lines after scene header
  R5  Add missing ▲ prefix on action-like lines

Output format:
  {
    "passed": true,
    "has_blocking": false,
    "fixes_applied": [...],
    "issues": [],
    "repair_plan": null,
    "stats": {...}
  }
"""

import re
import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Any, Tuple

SCENE_HEADER_RE = re.compile(
    r'^\d+-\d+\s+(?:日|夜|晨|清晨|黄昏|午后|凌晨|夜晚|深夜|黎明|白天|傍晚|中午)\s+(?:内|外)\s+'
)
CHAR_LINE_RE = re.compile(r'^(?:登场|出场)?人物[：:]')
EP_HEADER_NEEDS_COLON_RE = re.compile(r'^(第\s*\d+\s*集)\s+(\S.*)$')
EP_HEADER_HAS_COLON_RE = re.compile(r'^第\s*\d+\s*集[：:]')
DIALOGUE_IN_ACTION_RE = re.compile(
    r'^▲.*?[\w\u4e00-\u9fff]+\s*[（(][^）)]+[）)]\s*[：:].+'
)


def build_compound_map(catalog_path: Path) -> Dict[str, str]:
    """Build {compound_form: canonical_name} from catalog actors + props."""
    mapping: Dict[str, str] = {}
    try:
        data = json.loads(catalog_path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return mapping

    for category in ('actors', 'props'):
        for entry in data.get(category, []):
            name = entry.get('name', '').strip()
            if not name:
                continue
            for alias in entry.get('aliases', []):
                alias = alias.strip()
                if not alias:
                    continue
                for fmt in (f'{name}({alias})', f'{name}（{alias}）',
                            f'{alias}({name})', f'{alias}（{name}）'):
                    mapping[fmt] = name

    # longest first to avoid partial matches
    return dict(sorted(mapping.items(), key=lambda x: -len(x[0])))


def normalize(lines: List[str], compounds: Dict[str, str]) -> Tuple[List[str], Dict[str, int], List[dict]]:
    """Normalize lines and return (fixed_lines, fix_counts, warnings).

    fix_counts keys: R1..R5 (count of fixes applied per rule).
    warnings items include a 'rule' key (e.g. 'W1').
    """
    fix_counts: Dict[str, int] = {'R1': 0, 'R2': 0, 'R3': 0, 'R4': 0, 'R5': 0}
    warnings: List[dict] = []
    out: List[str] = []

    for i, raw in enumerate(lines):
        s = raw.strip()

        # R4: blank line after scene header
        if not s:
            if out and SCENE_HEADER_RE.match(out[-1]):
                fix_counts['R4'] += 1
                continue
            out.append(raw)
            continue

        # R3: episode header missing colon
        if not EP_HEADER_HAS_COLON_RE.match(s):
            m = EP_HEADER_NEEDS_COLON_RE.match(s)
            if m:
                s = f'{m.group(1)}：{m.group(2)}'
                fix_counts['R3'] += 1

        # R1: compound names
        for compound, canonical in compounds.items():
            if compound in s:
                s = s.replace(compound, canonical)
                fix_counts['R1'] += 1

        # R2: comma in 人物 line
        if CHAR_LINE_RE.match(s):
            sep = s.index('：') + 1 if '：' in s else s.index(':') + 1
            names = s[sep:]
            fixed = re.sub(r',\s*', '、', names)
            if fixed != names:
                s = s[:sep] + fixed
                fix_counts['R2'] += 1

        # R5: missing ▲ on action-like line
        if '→' in s and not s.startswith('▲') and '：' not in s and ':' not in s:
            if not SCENE_HEADER_RE.match(s) and not s.startswith(('人物', '道具', '状态', '旁白', '【')):
                s = f'▲{s}'
                fix_counts['R5'] += 1

        # W1: dialogue in action line
        if DIALOGUE_IN_ACTION_RE.match(s):
            warnings.append({'rule': 'W1', 'code': 'DIALOGUE_IN_ACTION', 'line': i + 1, 'text': s[:80]})

        out.append(s)

    return out, fix_counts, warnings


def main():
    ap = argparse.ArgumentParser(description='Normalize episode format for parse_script.py')
    ap.add_argument('--project-path', required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    project = Path(args.project_path).resolve()
    ep_dir = project / 'draft' / 'episodes'
    if not ep_dir.exists():
        output = {
            'passed': False,
            'has_blocking': True,
            'fixes_applied': [],
            'issues': [{'code': 'NO_EPISODES_DIR', 'severity': 'blocking', 'summary': f'{ep_dir} not found'}],
            'repair_plan': None,
            'stats': {},
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        sys.exit(2)

    ep_files = sorted(
        (f for f in ep_dir.iterdir() if f.suffix == '.md' and f.name.startswith('ep')),
        key=lambda f: int(re.search(r'\d+', f.name).group(0)) if re.search(r'\d+', f.name) else 0
    )
    if not ep_files:
        output = {
            'passed': False,
            'has_blocking': True,
            'fixes_applied': [],
            'issues': [{'code': 'NO_EPISODES', 'severity': 'blocking', 'summary': f'No ep*.md in {ep_dir}'}],
            'repair_plan': None,
            'stats': {},
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        sys.exit(2)

    compounds = build_compound_map(project / 'draft' / 'catalog.json')
    all_fix_counts: Dict[str, int] = {'R1': 0, 'R2': 0, 'R3': 0, 'R4': 0, 'R5': 0}
    all_warnings: List[dict] = []
    modified = 0

    for f in ep_files:
        lines = f.read_text(encoding='utf-8').split('\n')
        out, fix_counts, warns = normalize(lines, compounds)
        total_fixes = sum(fix_counts.values())
        if total_fixes:
            modified += 1
            if not args.dry_run:
                f.write_text('\n'.join(out), encoding='utf-8')
        for rule, count in fix_counts.items():
            all_fix_counts[rule] += count
        for w in warns:
            w['file'] = f.name
            all_warnings.append(w)

    # Build issues from warnings
    issues: List[dict] = []
    if all_warnings:
        # Group dialogue-in-action warnings
        dia_warnings = [w for w in all_warnings if w.get('code') == 'DIALOGUE_IN_ACTION']
        if dia_warnings:
            issues.append({
                'code': 'DIALOGUE_IN_ACTION',
                'severity': 'warning',
                'locations': [{'file': w['file'], 'line': w['line']} for w in dia_warnings[:10]],
                'summary': f'{len(dia_warnings)} 处动作行中嵌入对白，需要手动拆分',
                'repair_hint': '将对白拆分为独立行：▲动作 → 角色名（情绪）：台词',
            })

    passed = len(issues) == 0 or all(i['severity'] != 'error' and i['severity'] != 'blocking' for i in issues)
    has_blocking = any(i.get('severity') == 'blocking' for i in issues)

    total_fixes = sum(all_fix_counts.values())
    output = {
        'passed': passed,
        'has_blocking': has_blocking,
        'fixes_applied': all_fix_counts,
        'issues': issues,
        'repair_plan': None,
        'stats': {
            'files_processed': len(ep_files),
            'files_modified': modified,
            'total_fixes': total_fixes,
            'dry_run': args.dry_run,
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

    # Human summary to stderr
    if total_fixes:
        print(f'ℹ️  Applied {total_fixes} fixes to {modified} files.', file=sys.stderr)
    if all_warnings:
        print(f'⚠️  {len(all_warnings)} W1 warnings (dialogue in action line)', file=sys.stderr)


if __name__ == '__main__':
    main()
