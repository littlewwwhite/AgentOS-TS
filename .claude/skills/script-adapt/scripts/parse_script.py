#!/usr/bin/env python3
# input: draft/episodes/ep*.md, draft/catalog.json, draft/design.json
# output: output/script.json with structured script data + validation report
# pos: deterministic script parser and validator (replaces verify_episodes.py)

import re
import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Set, Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

from pipeline_state import ensure_state, update_artifact, update_stage

# ---------- Regex patterns ----------

# Scene header: "1-1 日 内 觉醒大厅" or "1-1 日 内 觉醒大厅【废墟】"
SCENE_HEADER_RE = re.compile(
    r'^(\d+)-(\d+)\s+(日|夜|晨|清晨|黄昏|午后|凌晨|夜晚|深夜|黎明|白天|傍晚|中午)\s+(内|外)\s+([^【]+?)(?:【(.+?)】)?\s*$'
)

# Episode header: "第N集" or "# 第 N 集：标题"
EPISODE_HEADER_RE = re.compile(r'^#?\s*第\s*(\d+)\s*集(?:[：:]\s*(.+?))?$')

# Actor line: "人物：角色A、角色B" (also tolerates "登场人物：" / "出场人物：")
CHAR_LINE_RE = re.compile(r'^(?:登场|出场)?人物[：:](.+)$')

# Prop line: "道具：断剑、玉佩"
PROP_LINE_RE = re.compile(r'^道具[：:](.+)$')

# State line: "状态：角色A【战甲】、角色B【婚纱】"
STATE_LINE_RE = re.compile(r'^状态[：:](.+)$')

# Action line: ▲动作描述
ACTION_LINE_RE = re.compile(r'^▲(.+)$')

# Bracket-tag line: 【标签：内容】
BRACKET_INLINE_RE = re.compile(r'^【([^：:]+)[：:](.+?)】$')

# Bracket speaker line: 【广播】：内容
BRACKET_SPEAKER_RE = re.compile(r'^【([^】]+)】[：:](.+)$')

# Narration line: "旁白：内容" or "旁白(...)：内容"
NARRATION_RE = re.compile(r'^旁白(?:[（(][^）)]*[）)])?[：:](.+)$')

# OS line: "角色名(OS)：内容"
OS_RE = re.compile(r'^(.+?)[（(]OS[）)][：:](.+)$')

# Dialogue line: "角色名(情绪)：台词" or "角色名：台词"
DIALOGUE_RE = re.compile(r'^([^▲【\s][^：:]*?)[：:](.+)$')

# Translation follow-up helpers
CJK_RE = re.compile(r'[\u4e00-\u9fff]')
LATIN_RE = re.compile(r'[A-Za-z]')
ENGLISH_DIALOGUE_LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 .'\-]{0,40}:\s+\S")

# Parenthetical annotations to strip: (声音), (稍后入场), etc.
ANNOTATION_RE = re.compile(r'[（(][^）)]*[）)]')

# State annotation: 【幼年】【战甲】
STATE_RE = re.compile(r'【(.+?)】')

# Malformed scene header: looks like scene header but missing location after 内/外
MALFORMED_SCENE_RE = re.compile(r'^(\d+)-(\d+)\s+.*?(?:内|外)(?:\s*)$')

# Group / extra patterns — never get individual actor IDs
GROUP_RE = re.compile(
    r'[×x]\d+|若干|众人$|等人$|们$|群$|大军$|大队$|弟子$|双胞胎|三胞胎|兄弟俩|姐妹俩'
)

# Non-actor tokens that should never become actors
JUNK_NAMES = {'无', '暂无', '略', '无人', '—', '/'}

# Chinese conjunctions to split multi-actor names like "女主和弟弟"
CONJUNCTION_RE = re.compile(r'和|及|与')

# NPC layer label
NPC_LAYER_RE = re.compile(r'NPC[：:]')

# Non-NPC layer labels to strip
LAYER_LABEL_RE = re.compile(r'(?:配角|龙套)[：:]')

# Time word → English mapping
TIME_MAP: Dict[str, str] = {
    '日': 'day',
    '白天': 'day',
    '晨': 'dawn',
    '夜': 'night',
    '夜晚': 'night',
    '深夜': 'night',
    '清晨': 'dawn',
    '黎明': 'dawn',
    '凌晨': 'dawn',
    '午后': 'noon',
    '中午': 'noon',
    '黄昏': 'dusk',
    '傍晚': 'dusk',
}

# Space word → English mapping
SPACE_MAP: Dict[str, str] = {
    '内': 'interior',
    '外': 'exterior',
}

NON_CHARACTER = {'旁白', '字幕'}
NON_SPEAKING_BRACKET_LABELS = {'字幕', 'subtitle', '音效', 'SFX', 'BGM'}
SPECIAL_ACTOR_ALIASES = {
    '系统': '系统',
    '系统提示': '系统',
    'system': '系统',
    'system prompt': '系统',
    'system notice': '系统',
}
SPECIAL_ACTOR_SUFFIXES = (
    '提示音',
    '提示',
    '播报',
    '通报',
    '通知',
)
SPECIAL_ACTOR_KEYWORDS = (
    '系统',
    '面板',
    '广播',
    '机械音',
    '电子音',
    '提示',
    'AI',
    '智脑',
    '光幕',
    '器灵',
    '精灵',
    '助手',
    '终端',
    '金手指',
    'system',
    'broadcast',
    'panel',
    'mechanical',
    'terminal',
    'assistant',
)


# ---------- Helpers ----------

def clean_name(name: str) -> str:
    """Normalize actor names while preserving identity suffixes like （成年）."""
    cleaned = name.strip()
    # Normalize English names: "BELLA" / "bella" / "Bella" → "Bella"
    if cleaned.isascii():
        cleaned = cleaned.title()
    return cleaned


def _build_alias_lookup() -> Dict[str, str]:
    """Build case-insensitive alias lookup from SPECIAL_ACTOR_ALIASES."""
    return {k.lower(): v for k, v in SPECIAL_ACTOR_ALIASES.items()}


_ALIAS_LOWER = _build_alias_lookup()


def normalize_special_actor_name(name: str) -> str:
    """Map special non-human speaker labels to canonical actor names."""
    normalized = name.strip()
    lower = normalized.lower()
    if lower in _ALIAS_LOWER:
        return _ALIAS_LOWER[lower]

    for suffix in SPECIAL_ACTOR_SUFFIXES:
        if normalized.endswith(suffix) and len(normalized) > len(suffix):
            normalized = normalized[:-len(suffix)].strip()
            break

    return _ALIAS_LOWER.get(normalized.lower(), normalized)


def looks_like_special_voice_actor(name: str) -> bool:
    """Return True for recurring non-human / system-like speakers."""
    normalized = normalize_special_actor_name(name)
    if normalized != name.strip():
        return True

    upper_name = normalized.upper()
    for keyword in SPECIAL_ACTOR_KEYWORDS:
        if keyword.isascii():
            if keyword.upper() in upper_name:
                return True
        elif keyword in normalized:
            return True
    return False


def parse_bracket_voice_line(text: str) -> Optional[Tuple[str, str, str]]:
    """Parse bracketed subtitle/speaker line.

    Returns (kind, label, content):
    - ('sfx', label, content) for non-speaking overlays like 字幕
    - ('dialogue', speaker_name, content) for special voice actors
    """
    match = BRACKET_INLINE_RE.match(text)
    if match:
        label = match.group(1).strip()
        content = match.group(2).strip()
    else:
        match = BRACKET_SPEAKER_RE.match(text)
        if not match:
            return None
        label = match.group(1).strip()
        content = match.group(2).strip()

    if label in NON_SPEAKING_BRACKET_LABELS:
        return ('sfx', label, content)

    return ('dialogue', normalize_special_actor_name(label), content)


def looks_like_identity_suffix(value: str) -> bool:
    """Return True when a trailing parenthetical looks like part of the actor identity."""
    normalized = value.strip()
    if not normalized:
        return False

    identity_keywords = (
        "岁",
        "成年",
        "幼年",
        "童年",
        "少年",
        "少女",
        "青年",
        "老年",
        "中年",
        "小时候",
        "幼时",
        "少年期",
        "青年期",
    )
    return any(keyword in normalized for keyword in identity_keywords)


def split_dialogue_speaker(speaker_part: str) -> Tuple[str, Optional[str]]:
    """Split speaker text into actor name and optional emotion.

    Examples:
    - "海莉（十八岁）（慌乱）" -> ("海莉（十八岁）", "慌乱")
    - "海莉（十八岁）" -> ("海莉（十八岁）", None)
    - "Alice(calm)" -> ("Alice", "calm")
    """
    speaker = speaker_part.strip()
    trailing = re.match(r"^(.*?)[（(]([^（）()]+)[）)]$", speaker)
    if not trailing:
        return clean_name(speaker), None

    candidate_name = trailing.group(1).strip()
    suffix = trailing.group(2).strip()
    if not candidate_name or looks_like_identity_suffix(suffix):
        return clean_name(speaker), None

    return clean_name(candidate_name), suffix


def extract_state(name: str) -> Tuple[str, Optional[str]]:
    """Extract state annotation from name like '角色【战甲】'."""
    m = STATE_RE.search(name)
    state = m.group(1) if m else None
    stripped = STATE_RE.sub('', name)
    return clean_name(stripped), state


def is_group(name: str) -> bool:
    """Check if name represents a group/extra rather than individual actor."""
    return bool(GROUP_RE.search(name)) or name in JUNK_NAMES


def parse_actor_line(raw: str) -> List[Tuple[str, Optional[str]]]:
    """Parse actor line into list of (name, state) tuples."""
    results: List[Tuple[str, Optional[str]]] = []
    layers = raw.split('/')

    for layer in layers:
        layer = layer.strip()

        # Handle NPC layer
        if NPC_LAYER_RE.search(layer):
            layer = NPC_LAYER_RE.sub('', layer).strip()
            if not layer:
                continue

        # Strip layer labels
        layer = LAYER_LABEL_RE.sub('', layer)

        # Split by Chinese separators
        for segment in re.split(r'[、，,;；]', layer):
            # Split Chinese conjunctions: "女主和弟弟" → ["女主", "弟弟"]
            sub_names = CONJUNCTION_RE.split(segment)

            for name in sub_names:
                cleaned, state = extract_state(name)
                if cleaned and not is_group(cleaned):
                    results.append((cleaned, state))

    return results


def parse_prop_line(raw: str) -> List[str]:
    """Parse prop line into list of unique prop names."""
    props: List[str] = []
    seen: Set[str] = set()

    for name in re.split(r'[、，,;；]', raw):
        cleaned = name.strip()
        if cleaned and cleaned not in seen:
            props.append(cleaned)
            seen.add(cleaned)

    return props


def fmt_id(n: int) -> str:
    """Format number as zero-padded 3-digit string."""
    return str(n).zfill(3)


# Valid asset ID pattern: act_001, loc_002, prp_003 etc.
_VALID_ID_RE = re.compile(r'^(act|loc|prp)_\d{3,}$')


def _sanitize_id(raw_id, prefix: str, seq: int) -> str:
    """Return raw_id if it matches the expected format, otherwise generate one."""
    if raw_id and _VALID_ID_RE.match(str(raw_id)):
        return str(raw_id)
    return f"{prefix}_{fmt_id(seq)}"


def is_english_translation_followup(text: str) -> bool:
    """Check whether a line looks like an English translation for the prior dialogue.

    NOTE: With the current writing rules (台词铁律 §0.2), bilingual scripts
    should place English dialogue on the SAME line as the character name
    (e.g. ``角色名（情绪）：English dialogue.``).  Standalone English lines
    are a legacy format.  This function still handles them for backward
    compatibility, but new scripts should not produce them.
    """
    stripped = text.strip()
    if not stripped:
        return False
    if CJK_RE.search(stripped):
        return False
    if not LATIN_RE.search(stripped):
        return False
    if stripped.startswith(('▲', '【')):
        return False
    if stripped.startswith(('人物：', '人物:', '道具：', '道具:', '状态：', '状态:')):
        return False
    # Previously, lines matching ENGLISH_DIALOGUE_LABEL_RE (e.g. "Hailey: ...")
    # were excluded here and fell through to DIALOGUE_RE, which could mis-assign
    # actor_id to the *addressed* character instead of the actual speaker.
    # Now we treat ALL pure-English lines after a dialogue as translation
    # follow-ups, regardless of whether they resemble "Name: text" format.
    # This is safe because real English dialogue lines should use the standard
    # format: 角色名（情绪）：English dialogue.
    return True


# ---------- Catalog / Design loaders ----------

class CatalogMappings:
    """Container for catalog.json mappings."""
    def __init__(self):
        self.actor_ids: Dict[str, str] = {}  # name|alias → id
        self.actor_primary_names: Dict[str, str] = {}  # primary name → id
        self.loc_ids: Dict[str, str] = {}  # name|alias → id
        self.actor_states: Dict[str, List[str]] = {}  # name → [state_names]
        self.prop_ids: Dict[str, str] = {}  # name|alias → id
        self.descriptions: Dict[str, str] = {}  # assetId → description
        self.state_descriptions: Dict[str, str] = {}  # "assetId|stateName" → description
        self.has_catalog: bool = False


def load_catalog_mappings(project_path: Path) -> CatalogMappings:
    """Load catalog.json and build name→id mappings."""
    catalog = CatalogMappings()
    catalog_path = project_path / 'draft' / 'catalog.json'

    try:
        with open(catalog_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return catalog

    catalog.has_catalog = True

    def load_states(asset_id: str, states: List[Any]) -> List[str]:
        """Extract state names and descriptions from either format."""
        names: List[str] = []
        for s in states:
            if isinstance(s, str):
                names.append(s)
            elif isinstance(s, dict) and 'name' in s:
                names.append(s['name'])
                if 'description' in s:
                    catalog.state_descriptions[f"{asset_id}|{s['name']}"] = s['description']
        return names

    def register_names(registry: Dict[str, str], entry: Dict[str, Any]) -> None:
        """Register primary name + aliases for an asset, case-normalized."""
        asset_id = entry['id']
        name = entry['name']
        registry[name.title() if name.isascii() else name] = asset_id
        for alias in entry.get('aliases', []):
            if alias:
                key = alias.title() if alias.isascii() else alias
                if key not in registry:
                    registry[key] = asset_id

    # Load actors
    for i, actor in enumerate(data.get('actors', [])):
        actor_id = _sanitize_id(actor.get('id'), 'act', i + 1)
        actor['id'] = actor_id
        register_names(catalog.actor_ids, actor)
        catalog.actor_primary_names[actor['name'].title() if actor['name'].isascii() else actor['name']] = actor_id
        if actor.get('states'):
            catalog.actor_states[actor['name']] = load_states(actor_id, actor['states'])
        if actor.get('description'):
            catalog.descriptions[actor_id] = actor['description']

    # Load locations
    for i, loc in enumerate(data.get('locations', [])):
        loc_id = _sanitize_id(loc.get('id'), 'loc', i + 1)
        loc['id'] = loc_id
        register_names(catalog.loc_ids, loc)
        if loc.get('states'):
            load_states(loc_id, loc['states'])
        if loc.get('description'):
            catalog.descriptions[loc_id] = loc['description']

    # Load props
    for i, prop in enumerate(data.get('props', [])):
        prop_id = _sanitize_id(prop.get('id'), 'prp', i + 1)
        prop['id'] = prop_id
        register_names(catalog.prop_ids, prop)
        if prop.get('states'):
            load_states(prop_id, prop['states'])
        if prop.get('description'):
            catalog.descriptions[prop_id] = prop['description']

    return catalog


def load_design_fields(project_path: Path) -> Dict[str, Any]:
    """Load design.json fields (title, style, worldview, bilingual)."""
    design_path = project_path / 'draft' / 'design.json'

    try:
        with open(design_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            'title': data.get('title', ''),
            'style': data.get('style', ''),
            'worldview': data.get('worldview', ''),
            'bilingual': data.get('bilingual', False),
        }
    except (FileNotFoundError, json.JSONDecodeError):
        return {'title': '', 'style': '', 'worldview': '', 'bilingual': False}


# ---------- Core parser ----------

def parse_episodes(project_path: Path, output_path: Optional[Path] = None) -> Dict[str, Any]:
    """Parse all ep*.md files and generate script.json."""
    episodes_dir = project_path / 'draft' / 'episodes'

    # Find all ep*.md files
    try:
        ep_files = sorted(
            [f for f in episodes_dir.iterdir() if f.is_file() and re.match(r'^ep.*\.md$', f.name, re.IGNORECASE)],
            key=lambda f: int(re.search(r'\d+', f.name).group(0)) if re.search(r'\d+', f.name) else 0
        )
    except FileNotFoundError:
        return {'error': f'Directory not found: {episodes_dir}'}

    if not ep_files:
        return {'error': f'No ep*.md files in {episodes_dir}'}

    # Load external data
    catalog = load_catalog_mappings(project_path)
    design = load_design_fields(project_path)

    # Catalog-only registries — no auto-creation when catalog exists
    actors: Dict[str, str] = dict(catalog.actor_ids)
    locations: Dict[str, str] = dict(catalog.loc_ids)
    props: Dict[str, str] = dict(catalog.prop_ids)

    # Fallback counters — only used when no catalog.json exists
    actor_counter = len(catalog.actor_ids)
    loc_counter = len(catalog.loc_ids)
    prop_counter = len(catalog.prop_ids)

    # Track names that couldn't be resolved to catalog entries
    unresolved_actors: Set[str] = set()
    unresolved_locations: Set[str] = set()
    unresolved_props: Set[str] = set()

    # Validation tracking
    validation_issues: List[Dict[str, Any]] = []
    scene_has_char_line: Dict[int, bool] = {}       # scn_counter -> has explicit 人物: line
    scene_char_line_names: Dict[int, Set[str]] = {}  # scn_counter -> names from 人物: line
    scene_dialogue_names: Dict[int, Set[str]] = {}   # scn_counter -> names from dialogue/OS
    bilingual = design.get('bilingual', False)

    # Location state tracking (per location)
    loc_state_names: Dict[str, List[str]] = {}
    scene_loc_states: Dict[int, Optional[Tuple[str, str]]] = {}

    def register_location(name: str) -> Optional[str]:
        """Register location and return its ID, or None if unresolved."""
        nonlocal loc_counter
        if name in locations:
            return locations[name]
        if catalog.has_catalog:
            unresolved_locations.add(name)
            return None
        loc_counter += 1
        lid = f'loc_{fmt_id(loc_counter)}'
        locations[name] = lid
        return lid

    def register_actor(name: str, allow_special_actor: bool = False) -> Optional[str]:
        """Register actor and return its ID, or None if unresolved."""
        nonlocal actor_counter
        if name in actors:
            return actors[name]
        canonical_name = normalize_special_actor_name(name)
        if not canonical_name or is_group(canonical_name) or canonical_name in NON_CHARACTER:
            return None
        if canonical_name in actors:
            return actors[canonical_name]
        is_special_actor = allow_special_actor or looks_like_special_voice_actor(canonical_name)
        if catalog.has_catalog and not is_special_actor:
            unresolved_actors.add(canonical_name)
            return None
        actor_counter += 1
        aid = f'act_{fmt_id(actor_counter)}'
        actors[canonical_name] = aid
        return aid

    def register_prop(name: str) -> Optional[str]:
        """Register prop and return its ID, or None if unresolved."""
        nonlocal prop_counter
        prop_name = name.strip()
        if not prop_name:
            return None
        if prop_name in props:
            return props[prop_name]
        if catalog.has_catalog:
            unresolved_props.add(prop_name)
            return None
        prop_counter += 1
        pid = f'prp_{fmt_id(prop_counter)}'
        props[prop_name] = pid
        return pid

    # Track per-scene state annotations and actor list
    scene_actor_states: Dict[int, List[Tuple[str, str]]] = {}
    scene_actor_map: Dict[int, Dict[str, Optional[str]]] = {}

    def register_scene_actor(scn_num: int, actor_id: str, state_name: Optional[str] = None) -> None:
        """Register actor in scene with optional state."""
        if scn_num not in scene_actor_map:
            scene_actor_map[scn_num] = {}
        actor_map = scene_actor_map[scn_num]

        if actor_id not in actor_map:
            actor_map[actor_id] = state_name
            return

        # Update state if current is None and new state is provided
        if actor_map[actor_id] is None and state_name is not None:
            actor_map[actor_id] = state_name

    # Parse
    episodes: List[Dict[str, Any]] = []
    current_episode: Optional[Dict[str, Any]] = None
    current_scene: Optional[Dict[str, Any]] = None
    scn_counter = 0  # global scene counter
    ep_scn_counter = 0  # per-episode scene counter
    current_ep_num = 0
    scene_global_idx: Dict[int, int] = {}  # scene object id → global scene number

    # Track scene prop IDs to avoid duplicates (keyed by global scene index)
    scene_prop_ids: Dict[int, List[str]] = {}

    def flush_scene() -> None:
        """Flush current scene to current episode."""
        nonlocal current_scene
        if current_scene and current_episode:
            current_episode['scenes'].append(current_scene)
            current_scene = None

    def flush_episode() -> None:
        """Flush current episode to episodes list."""
        nonlocal current_episode
        flush_scene()
        if current_episode:
            episodes.append(current_episode)
            current_episode = None

    def add_action(
        scene: Dict[str, Any],
        action_type: str,
        content: str,
        actor_id: Optional[str] = None,
        emotion: Optional[str] = None
    ) -> Dict[str, Any]:
        """Add action to scene and return the action dict."""
        action: Dict[str, Any] = {'type': action_type, 'content': content}
        if actor_id:
            action['actor_id'] = actor_id
        if emotion:
            action['emotion'] = emotion
        scene['actions'].append(action)
        return action

    def should_merge_with_current_scene(
        scene: Optional[Dict[str, Any]],
        loc_id: Optional[str],
        space: str,
        time: str,
        loc_state_name: Optional[str],
    ) -> bool:
        """Merge consecutive headers when they stay in the same scene space."""
        if not scene or not scene.get('locations') or loc_id is None:
            return False

        current_loc = scene['locations'][0].get('location_id')
        if current_loc != loc_id:
            return False

        current_env = scene.get('environment', {})
        if current_env.get('space') != space or current_env.get('time') != time:
            return False

        current_loc_state = scene_loc_states.get(scn_counter)
        current_state_name = current_loc_state[1] if current_loc_state else None
        return current_state_name == loc_state_name

    # Main parsing loop
    for ep_file in ep_files:
        with open(ep_file, 'r', encoding='utf-8') as f:
            text = f.read()

        last_dialogue_action: Optional[Dict[str, Any]] = None

        for line in text.split('\n'):
            stripped = line.strip()
            if not stripped:
                continue

            # English translation follow-up: keep the English line as the structured dialogue content.
            if last_dialogue_action is not None and is_english_translation_followup(stripped):
                # Guard: if the line is an independent English dialogue from a known actor,
                # do NOT treat it as a translation — let it fall through to normal parsing.
                _dm = DIALOGUE_RE.match(stripped)
                _is_own_dialogue = False
                if _dm:
                    _spk, _ = split_dialogue_speaker(_dm.group(1))
                    _is_own_dialogue = _spk in actors
                if not _is_own_dialogue:
                    last_dialogue_action['content'] = stripped
                    last_dialogue_action = None
                    continue
                last_dialogue_action = None

            # Any non-translation line resets the pending translation reference.
            last_dialogue_action = None

            # 0. Episode header
            m = EPISODE_HEADER_RE.match(stripped)
            if m:
                flush_episode()
                current_ep_num = int(m.group(1))
                current_episode = {
                    'episode_id': f'ep_{fmt_id(current_ep_num)}',
                    'episode_num': current_ep_num,
                    'title': m.group(2).strip() if m.group(2) else None,
                    'scenes': [],
                }
                ep_scn_counter = 0
                continue

            # 1. Scene header
            m = SCENE_HEADER_RE.match(stripped)
            if m:
                loc_name = m.group(5).strip()
                loc_state_name = m.group(6).strip() if m.group(6) else None
                loc_id = register_location(loc_name)
                space = SPACE_MAP.get(m.group(4), m.group(4))
                time = TIME_MAP.get(m.group(3), m.group(3))

                if should_merge_with_current_scene(current_scene, loc_id, space, time, loc_state_name):
                    continue

                flush_scene()
                scn_counter += 1
                ep_scn_counter += 1

                # Auto-create episode if not exists
                if not current_episode:
                    current_ep_num = int(m.group(1))
                    current_episode = {
                        'episode_id': f'ep_{fmt_id(current_ep_num)}',
                        'episode_num': current_ep_num,
                        'title': None,
                        'scenes': [],
                    }
                    ep_scn_counter = 1

                scene_id = f'scn_{fmt_id(ep_scn_counter)}'

                current_scene = {
                    'scene_id': scene_id,
                    'environment': {'space': space, 'time': time},
                    'locations': [{'location_id': loc_id, 'state_id': None}] if loc_id else [],
                    'actors': [],
                    'props': [],
                    'actions': [],
                }

                scene_global_idx[id(current_scene)] = scn_counter
                scene_prop_ids[scn_counter] = []

                if loc_state_name and loc_id:
                    scene_loc_states[scn_counter] = (loc_id, loc_state_name)
                    if loc_id not in loc_state_names:
                        loc_state_names[loc_id] = []
                    if loc_state_name not in loc_state_names[loc_id]:
                        loc_state_names[loc_id].append(loc_state_name)
                else:
                    scene_loc_states[scn_counter] = None

                scene_actor_states[scn_counter] = []
                scene_actor_map[scn_counter] = {}

                # Validation: initialize per-scene tracking
                scene_has_char_line[scn_counter] = False
                scene_char_line_names[scn_counter] = set()
                scene_dialogue_names[scn_counter] = set()

                # Validation: empty location
                if not loc_name:
                    validation_issues.append({
                        'code': 'EMPTY_LOCATION',
                        'severity': 'blocking',
                        'episode': current_episode['episode_id'] if current_episode else '?',
                        'scene': scene_id,
                        'summary': f'Scene {scene_id} header has no location name',
                        'repair_hint': 'Fix format: N-N time interior/exterior LocationName',
                    })

                continue

            # Validation: malformed scene header (looks like N-N...内/外 but didn't match)
            if MALFORMED_SCENE_RE.match(stripped):
                m_mal = MALFORMED_SCENE_RE.match(stripped)
                validation_issues.append({
                    'code': 'MALFORMED_SCENE_HEADER',
                    'severity': 'blocking',
                    'episode': current_episode['episode_id'] if current_episode else '?',
                    'scene': f'{m_mal.group(1)}-{m_mal.group(2)}',
                    'summary': f'Malformed scene header: {stripped[:60]}',
                    'repair_hint': 'Fix format: N-N time interior/exterior LocationName',
                })
                continue

            if not current_scene:
                # Episode-level actor line (before first scene) — store as fallback
                m = CHAR_LINE_RE.match(stripped)
                if m:
                    for name, state in parse_actor_line(m.group(1)):
                        register_actor(name)
                continue

            # 2. Actor line
            m = CHAR_LINE_RE.match(stripped)
            if m:
                scene_has_char_line[scn_counter] = True
                for name, state in parse_actor_line(m.group(1)):
                    scene_char_line_names[scn_counter].add(name)
                    cid = register_actor(name)
                    if cid:
                        if state:
                            if name in catalog.actor_states:
                                if state not in catalog.actor_states[name]:
                                    print(
                                        f"⚠️  Warning: Actor '{name}' state '{state}' not in catalog.json states: {json.dumps(catalog.actor_states[name])}",
                                        file=sys.stderr
                                    )
                            scene_actor_states[scn_counter].append((cid, state))
                            register_scene_actor(scn_counter, cid, state)
                        else:
                            register_scene_actor(scn_counter, cid, None)
                continue

            # 3. Prop line
            m = PROP_LINE_RE.match(stripped)
            if m:
                prop_ids = scene_prop_ids[scn_counter]
                for prop_name in parse_prop_line(m.group(1)):
                    pid = register_prop(prop_name)
                    if pid and pid not in prop_ids:
                        prop_ids.append(pid)
                continue

            # 3.5 State line: "状态：角色A【战甲】、道具B【碎裂】"
            m = STATE_LINE_RE.match(stripped)
            if m:
                for entry in re.split(r'[、，,;；]', m.group(1)):
                    name, state = extract_state(entry)
                    if not name or not state:
                        continue

                    # Try actor first
                    cid = actors.get(name) or register_actor(name)
                    if cid:
                        if name in catalog.actor_states:
                            if state not in catalog.actor_states[name]:
                                print(
                                    f"⚠️  Warning: Actor '{name}' state '{state}' not in catalog.json states: {json.dumps(catalog.actor_states[name])}",
                                    file=sys.stderr
                                )
                        scene_actor_states[scn_counter].append((cid, state))
                        register_scene_actor(scn_counter, cid, state)
                continue

            # 4. Bracket subtitle / special speaker
            bracket_voice = parse_bracket_voice_line(stripped)
            if bracket_voice:
                action_kind, label, content = bracket_voice
                if action_kind == 'sfx':
                    add_action(current_scene, 'action', content)
                    continue

                scene_dialogue_names.setdefault(scn_counter, set()).add(label)
                cid = register_actor(label, allow_special_actor=True)
                if cid:
                    register_scene_actor(scn_counter, cid, None)
                add_action(current_scene, 'dialogue', content, cid)
                continue

            # 5. Action line
            m = ACTION_LINE_RE.match(stripped)
            if m:
                content = m.group(1).strip()
                add_action(current_scene, 'action', content)
                # Fallback: only match catalog primary actor names from action text.
                # Aliases are allowed in strict fields like 人物/对白/OS, but using them
                # as raw substring probes in prose causes false positives such as
                # single-character aliases ("本") matching unrelated words ("本能", "笔记本").
                if catalog.has_catalog:
                    for name, aid in catalog.actor_primary_names.items():
                        if name in content and not is_group(name) and name not in NON_CHARACTER:
                            register_scene_actor(scn_counter, aid, None)
                continue

            # 6. Narration line (check before OS and dialogue to avoid being caught by DIALOGUE_RE)
            m = NARRATION_RE.match(stripped)
            if m:
                add_action(current_scene, 'narration', m.group(1).strip())
                continue

            # 7. OS line (check before dialogue)
            m = OS_RE.match(stripped)
            if m:
                cleaned = normalize_special_actor_name(clean_name(m.group(1)))
                scene_dialogue_names.setdefault(scn_counter, set()).add(cleaned)
                cid = register_actor(cleaned, allow_special_actor=looks_like_special_voice_actor(cleaned))
                if cid:
                    register_scene_actor(scn_counter, cid, None)
                add_action(current_scene, 'inner_thought', m.group(2).strip(), cid)
                continue

            # 8. Dialogue line
            m = DIALOGUE_RE.match(stripped)
            if m:
                cleaned, emotion = split_dialogue_speaker(m.group(1))
                cleaned = normalize_special_actor_name(cleaned)
                if cleaned.startswith('【') or cleaned in NON_CHARACTER:
                    continue
                scene_dialogue_names.setdefault(scn_counter, set()).add(cleaned)
                cid = register_actor(cleaned, allow_special_actor=looks_like_special_voice_actor(cleaned))
                if cid:
                    register_scene_actor(scn_counter, cid, None)
                content = m.group(2).strip()
                # Validation: chinese residue in bilingual mode
                if bilingual and CJK_RE.search(content):
                    validation_issues.append({
                        'code': 'CHINESE_RESIDUE',
                        'severity': 'warning',
                        'episode': current_episode['episode_id'] if current_episode else '?',
                        'scene': current_scene['scene_id'] if current_scene else '?',
                        'summary': f"Chinese in bilingual dialogue: {cleaned}: {content[:40]}",
                        'repair_hint': 'Replace with English dialogue',
                    })
                last_dialogue_action = add_action(current_scene, 'dialogue', content, cid, emotion)
                continue

    flush_episode()

    # ---------- Count scene appearances per asset ----------
    actor_scene_count: Dict[str, int] = {}
    loc_scene_count: Dict[str, int] = {}
    prop_scene_count: Dict[str, int] = {}

    for ep in episodes:
        for scene in ep['scenes']:
            scn_num = scene_global_idx[id(scene)]
            for aid in scene_actor_map.get(scn_num, {}):
                actor_scene_count[aid] = actor_scene_count.get(aid, 0) + 1
            for loc_entry in scene.get('locations', []):
                lid = loc_entry.get('location_id')
                if lid:
                    loc_scene_count[lid] = loc_scene_count.get(lid, 0) + 1
            for pid in scene_prop_ids.get(scn_num, []):
                prop_scene_count[pid] = prop_scene_count.get(pid, 0) + 1

    # Filter actors appearing < 2 times (exempt those with dialogue)
    filtered_actor_ids: Set[str] = {
        aid for aid, count in actor_scene_count.items() if count < 2
    }
    for aid in set(actors.values()):
        if aid not in actor_scene_count:
            filtered_actor_ids.add(aid)

    actors_with_dialogue: Set[str] = set()
    for ep in episodes:
        for scene in ep['scenes']:
            for action in scene['actions']:
                if action.get('type') in ('dialogue', 'inner_thought') and action.get('actor_id'):
                    actors_with_dialogue.add(action['actor_id'])
    filtered_actor_ids -= actors_with_dialogue

    if filtered_actor_ids:
        # Reverse lookup: aid → first registered name
        aid_to_name = {aid: name for name, aid in actors.items()}
        filtered_names = sorted(aid_to_name[aid] for aid in filtered_actor_ids if aid in aid_to_name)
        if filtered_names:
            print(
                f"ℹ️  Filtered {len(filtered_names)} actor(s) with < 2 appearances: {', '.join(filtered_names)}",
                file=sys.stderr
            )

    # ---------- Collect per-actor states ----------
    actor_state_names: Dict[str, List[str]] = {aid: [] for aid in actors.values()}

    for ep in episodes:
        for scene in ep['scenes']:
            scn_num = scene_global_idx[id(scene)]
            for aid, state_name in scene_actor_states.get(scn_num, []):
                if aid in actor_state_names and state_name not in actor_state_names[aid]:
                    actor_state_names[aid].append(state_name)

    # Build actors list with globally unique state IDs
    # Deduplicate: aliases map multiple names to the same ID, only emit each ID once
    state_counter = 0
    state_id_map: Dict[str, str] = {}  # "aid|stateName" → stateId

    # Collect canonical name per ID (first registered name wins — that's the catalog primary name)
    actor_canonical: Dict[str, str] = {}
    for name, aid in actors.items():
        if aid not in actor_canonical:
            actor_canonical[aid] = name

    actor_ids_sorted = sorted(
        [aid for aid in actor_canonical if aid not in filtered_actor_ids],
        key=lambda aid: actor_scene_count.get(aid, 0),
        reverse=True,
    )
    actors_list: List[Dict[str, Any]] = []

    for aid in actor_ids_sorted:
        name = actor_canonical[aid]
        states_for_actor = actor_state_names.get(aid, [])
        entry: Dict[str, Any] = {'actor_id': aid, 'actor_name': name}

        if aid in catalog.descriptions:
            entry['description'] = catalog.descriptions[aid]

        if states_for_actor:
            states_list: List[Dict[str, Any]] = []
            for state_name in states_for_actor:
                state_counter += 1
                state_id = f'st_{fmt_id(state_counter)}'
                state_entry: Dict[str, Any] = {'state_id': state_id, 'state_name': state_name}

                state_desc = catalog.state_descriptions.get(f'{aid}|{state_name}')
                if state_desc:
                    state_entry['description'] = state_desc

                states_list.append(state_entry)
                state_id_map[f'{aid}|{state_name}'] = state_id

            entry['states'] = states_list

        actors_list.append(entry)

    # Resolve scene.actors with concrete state IDs
    for ep in episodes:
        for scene in ep['scenes']:
            scn_num = scene_global_idx[id(scene)]
            actor_entries: List[Dict[str, Any]] = []

            for aid, state_name in scene_actor_map.get(scn_num, {}).items():
                if aid in filtered_actor_ids:
                    continue
                state_id = state_id_map.get(f'{aid}|{state_name}') if state_name else None
                actor_entries.append({'actor_id': aid, 'state_id': state_id})

            scene['actors'] = actor_entries

    # Nullify actor_id references for filtered actors in actions
    for ep in episodes:
        for scene in ep['scenes']:
            for action in scene['actions']:
                if action.get('actor_id') in filtered_actor_ids:
                    action['actor_id'] = None

    # Build locations list with state IDs (continue global state_counter)
    # Deduplicate aliases
    loc_state_id_map: Dict[str, str] = {}
    loc_canonical: Dict[str, str] = {}
    for name, lid in locations.items():
        if lid not in loc_canonical:
            loc_canonical[lid] = name

    loc_ids_sorted = sorted(
        loc_canonical.keys(),
        key=lambda lid: loc_scene_count.get(lid, 0),
        reverse=True,
    )
    locations_list: List[Dict[str, Any]] = []

    for lid in loc_ids_sorted:
        name = loc_canonical[lid]
        state_names_for_loc = loc_state_names.get(lid, [])
        entry: Dict[str, Any] = {'location_id': lid, 'location_name': name}

        if lid in catalog.descriptions:
            entry['description'] = catalog.descriptions[lid]

        if state_names_for_loc:
            states_list: List[Dict[str, Any]] = []
            for state_name in state_names_for_loc:
                state_counter += 1
                state_id = f'st_{fmt_id(state_counter)}'
                state_entry: Dict[str, Any] = {'state_id': state_id, 'state_name': state_name}

                state_desc = catalog.state_descriptions.get(f'{lid}|{state_name}')
                if state_desc:
                    state_entry['description'] = state_desc

                states_list.append(state_entry)
                loc_state_id_map[f'{lid}|{state_name}'] = state_id

            entry['states'] = states_list

        locations_list.append(entry)

    # Build props list — deduplicate aliases
    prop_canonical: Dict[str, str] = {}
    for name, pid in props.items():
        if pid not in prop_canonical:
            prop_canonical[pid] = name

    prop_ids_sorted = sorted(
        prop_canonical.keys(),
        key=lambda pid: prop_scene_count.get(pid, 0),
        reverse=True,
    )
    props_list: List[Dict[str, Any]] = []

    for pid in prop_ids_sorted:
        name = prop_canonical[pid]
        entry: Dict[str, Any] = {'prop_id': pid, 'prop_name': name}

        if pid in catalog.descriptions:
            entry['description'] = catalog.descriptions[pid]

        props_list.append(entry)

    # Resolve scene.locations[*].state_id and scene.props
    for ep in episodes:
        for scene in ep['scenes']:
            scn_num = scene_global_idx[id(scene)]

            # Location state
            loc_state = scene_loc_states.get(scn_num)
            if loc_state:
                lid, state_name = loc_state
                loc_state_id = loc_state_id_map.get(f'{lid}|{state_name}')
                if loc_state_id and scene['locations']:
                    scene['locations'][0]['state_id'] = loc_state_id

            # Props (no state from parser)
            scene['props'] = [
                {'prop_id': pid, 'state_id': None}
                for pid in scene_prop_ids.get(scn_num, [])
            ]

    # ---------- Cross-episode scene merge ----------
    # When the last scene of ep[i] and the first scene of ep[i+1] share the
    # same location, space, time, and location state, merge them into one scene
    # to avoid artificial splits caused by episode boundaries.
    merge_count = 0
    i = 0
    while i < len(episodes) - 1:
        ep_curr = episodes[i]
        ep_next = episodes[i + 1]

        if not ep_curr['scenes'] or not ep_next['scenes']:
            i += 1
            continue

        last_scene = ep_curr['scenes'][-1]
        first_scene = ep_next['scenes'][0]

        # Check mergeable: same location_id, state_id, space, time
        mergeable = False
        if (last_scene.get('locations') and first_scene.get('locations')):
            loc_a = last_scene['locations'][0]
            loc_b = first_scene['locations'][0]
            env_a = last_scene.get('environment', {})
            env_b = first_scene.get('environment', {})
            mergeable = (
                loc_a.get('location_id') == loc_b.get('location_id')
                and loc_a.get('state_id') == loc_b.get('state_id')
                and env_a.get('space') == env_b.get('space')
                and env_a.get('time') == env_b.get('time')
            )

        if not mergeable:
            i += 1
            continue

        # Merge: append actions, union actors (with state update) and props
        last_scene['actions'].extend(first_scene['actions'])

        # P1 fix: for actors already present, update state_id if the later
        # scene carries a newer state (e.g. costume change, injury).
        existing_actors = {a['actor_id']: a for a in last_scene['actors']}
        for actor in first_scene['actors']:
            aid = actor['actor_id']
            if aid not in existing_actors:
                last_scene['actors'].append(actor)
                existing_actors[aid] = actor
            elif actor.get('state_id') is not None:
                existing_actors[aid]['state_id'] = actor['state_id']

        existing_prop_ids = {p['prop_id'] for p in last_scene['props']}
        for prop in first_scene['props']:
            if prop['prop_id'] not in existing_prop_ids:
                last_scene['props'].append(prop)
                existing_prop_ids.add(prop['prop_id'])

        ep_next['scenes'].pop(0)
        merge_count += 1

        # Renumber remaining scenes in ep_next
        for idx, scene in enumerate(ep_next['scenes']):
            scene['scene_id'] = f'scn_{fmt_id(idx + 1)}'

        # P0 fix: never delete empty episodes — preserve episode boundaries
        # as authoritative narrative splits for downstream consumers.
        i += 1

    if merge_count:
        print(f'ℹ️  Merged {merge_count} cross-episode scene(s) with matching locations.', file=sys.stderr)

    # Strip internal episode_num before output
    output_episodes = [{k: v for k, v in ep.items() if k != 'episode_num'} for ep in episodes]

    script_data = {
        'title': design['title'],
        'worldview': design['worldview'] or None,
        'style': design['style'] or None,
        'actors': actors_list,
        'locations': locations_list,
        'props': props_list,
        'episodes': output_episodes,
    }

    # Write output
    output_dir = output_path if output_path else project_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)
    script_path = output_dir / 'script.json'

    with open(script_path, 'w', encoding='utf-8') as f:
        json.dump(script_data, f, ensure_ascii=False, indent=2)

    total_scenes = sum(len(ep['scenes']) for ep in episodes)

    # ---------- Post-parse validation ----------

    if ep_files and total_scenes == 0:
        validation_issues.append({
            'code': 'NO_SCENES_PARSED',
            'severity': 'blocking',
            'summary': (
                f"Found {len(ep_files)} ep*.md file(s), but none matched the required "
                "scene format: {ep}-{scene} {time} {内/外} {location}"
            ),
            'repair_hint': (
                "Rewrite draft/episodes/ep*.md using the script-adapt format: 第1集, "
                "1-1 日 内 地点, 人物：角色, ▲动作, 角色（情绪）：台词"
            ),
        })

    # Missing char lines
    for ep in episodes:
        for scene in ep['scenes']:
            scn_num = scene_global_idx.get(id(scene))
            if scn_num is not None and not scene_has_char_line.get(scn_num, False):
                validation_issues.append({
                    'code': 'MISSING_CHAR_LINE',
                    'severity': 'error',
                    'episode': ep.get('episode_id', '?'),
                    'scene': scene['scene_id'],
                    'summary': f"Scene {scene['scene_id']} has no 人物: line",
                    'repair_hint': 'Add: 人物：角色A、角色B',
                })

    # Actor mismatches (dialogue speaker not in char line)
    for scn_num, dia_names in scene_dialogue_names.items():
        char_names = scene_char_line_names.get(scn_num, set())
        if not char_names:
            continue  # Already flagged as MISSING_CHAR_LINE
        for name in dia_names:
            if looks_like_special_voice_actor(name):
                continue
            if name not in char_names:
                # Check via catalog resolution
                resolved = actors.get(name)
                char_resolved = {actors.get(n, n) for n in char_names}
                if resolved not in char_resolved:
                    validation_issues.append({
                        'code': 'ACTOR_MISMATCH',
                        'severity': 'warning',
                        'summary': f"Dialogue speaker '{name}' not in 人物: line",
                        'repair_hint': f"Add '{name}' to the 人物: line of this scene",
                    })

    # Unregistered assets
    if unresolved_actors:
        validation_issues.append({
            'code': 'UNREGISTERED_ACTOR',
            'severity': 'error',
            'summary': f"{len(unresolved_actors)} actor(s) not in catalog: {', '.join(sorted(unresolved_actors)[:10])}",
            'repair_hint': f"Add to catalog.json actors[]: {', '.join(sorted(unresolved_actors)[:5])}",
        })
    if unresolved_locations:
        validation_issues.append({
            'code': 'UNREGISTERED_LOCATION',
            'severity': 'error',
            'summary': f"{len(unresolved_locations)} location(s) not in catalog: {', '.join(sorted(unresolved_locations)[:10])}",
            'repair_hint': f"Add to catalog.json locations[]: {', '.join(sorted(unresolved_locations)[:5])}",
        })
    if unresolved_props:
        validation_issues.append({
            'code': 'UNREGISTERED_PROP',
            'severity': 'warning',
            'summary': f"{len(unresolved_props)} prop(s) not in catalog: {', '.join(sorted(unresolved_props)[:10])}",
            'repair_hint': f"Add to catalog.json props[]: {', '.join(sorted(unresolved_props)[:5])}",
        })

    # Build validation report
    has_blocking = any(i['severity'] == 'blocking' for i in validation_issues)
    has_errors = any(i['severity'] == 'error' for i in validation_issues)
    validation_passed = not has_blocking and not has_errors

    validation: Dict[str, Any] = {
        'passed': validation_passed,
        'has_blocking': has_blocking,
        'issues': validation_issues,
    }
    if not validation_passed:
        repair_steps = [
            {'action': i['code'].lower(), 'detail': i['repair_hint']}
            for i in validation_issues if i['severity'] != 'blocking'
        ]
        if repair_steps:
            validation['repair_plan'] = {'steps': repair_steps}

    # Human-readable summary to stderr
    if validation_passed:
        print('✅ Validation passed', file=sys.stderr)
    else:
        severity_counts = {'blocking': 0, 'error': 0, 'warning': 0}
        for i in validation_issues:
            severity_counts[i['severity']] = severity_counts.get(i['severity'], 0) + 1
        parts = [f"{v} {k}" for k, v in severity_counts.items() if v > 0]
        print(f'⚠️  Validation: {", ".join(parts)}', file=sys.stderr)
        for i in validation_issues[:5]:
            print(f'  [{i["severity"].upper()}] {i["code"]}: {i["summary"]}', file=sys.stderr)

    # Legacy warnings (backward compat)
    warnings: List[str] = []
    if unresolved_actors:
        warnings.append(f"Unresolved actors: {', '.join(sorted(unresolved_actors))}")
    if unresolved_locations:
        warnings.append(f"Unresolved locations: {', '.join(sorted(unresolved_locations))}")
    if unresolved_props:
        warnings.append(f"Unresolved props: {', '.join(sorted(unresolved_props))}")

    stats: Dict[str, Any] = {
        'total_scenes': total_scenes,
        'total_actors': len(actors_list),
        'filtered_actors': len(filtered_actor_ids),
        'total_locations': len(locations_list),
        'total_episodes': len(episodes),
        'episodes_parsed': len(ep_files),
    }
    if merge_count:
        stats['cross_episode_merges'] = merge_count

    artifact_path = script_path.relative_to(project_path).as_posix()
    ensure_state(str(project_path))
    update_artifact(
        str(project_path),
        artifact_path,
        'canonical',
        'writer',
        'completed' if validation_passed else 'in_review',
    )
    update_stage(
        str(project_path),
        'SCRIPT',
        'validated' if validation_passed else 'partial',
        next_action='enter VISUAL' if validation_passed else 'review SCRIPT',
        artifact=artifact_path,
    )

    return {
        'script_path': str(script_path),
        'stats': stats,
        'validation': validation,
        **({'warnings': warnings} if warnings else {}),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Parse episode scripts and generate script.json'
    )
    parser.add_argument(
        '--project-path',
        required=True,
        help='Path to project directory containing draft/'
    )
    parser.add_argument(
        '--output-path',
        default=None,
        help='Path to output directory for script.json (default: <project-path>/output/)'
    )
    parser.add_argument(
        '--validate',
        action='store_true',
        help='Exit with non-zero code if validation fails (0=pass, 1=errors, 2=blocking)',
    )
    args = parser.parse_args()

    project_path = Path(args.project_path).resolve()
    output_path = Path(args.output_path).resolve() if args.output_path else None
    result = parse_episodes(project_path, output_path)

    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.validate:
        validation = result.get('validation', {})
        if validation.get('has_blocking'):
            sys.exit(2)
        elif not validation.get('passed', True):
            sys.exit(1)
