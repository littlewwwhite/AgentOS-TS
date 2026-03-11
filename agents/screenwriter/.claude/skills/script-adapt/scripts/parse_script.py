#!/usr/bin/env python3
# input: draft/episodes/ep*.md, draft/catalog.json, draft/design.json
# output: output/script.json with structured script data
# pos: deterministic script parser for AgentOS-TS skill system

import re
import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Set, Any

# ---------- Regex patterns ----------

# Scene header: "1-1 日 内 觉醒大厅" or "1-1 日 内 觉醒大厅【废墟】"
SCENE_HEADER_RE = re.compile(
    r'^(\d+)-(\d+)\s+(日|夜|清晨|黄昏|午后|凌晨|夜晚|深夜|黎明|白天|傍晚|中午)\s+(内|外)\s+([^【]+?)(?:【(.+?)】)?\s*$'
)

# Episode header: "第N集" or "# 第 N 集：标题"
EPISODE_HEADER_RE = re.compile(r'^#?\s*第\s*(\d+)\s*集(?:[：:]\s*(.+?))?$')

# Actor line: "人物：角色A、角色B"
CHAR_LINE_RE = re.compile(r'^人物[：:](.+)$')

# Prop line: "道具：断剑、玉佩"
PROP_LINE_RE = re.compile(r'^道具[：:](.+)$')

# State line: "状态：角色A【战甲】、角色B【婚纱】"
STATE_LINE_RE = re.compile(r'^状态[：:](.+)$')

# Action line: ▲动作描述
ACTION_LINE_RE = re.compile(r'^▲(.+)$')

# Subtitle: 【字幕：内容】
SUBTITLE_RE = re.compile(r'^【字幕[：:](.+?)】$')

# System prompt: 【系统提示：内容】
SYSTEM_RE = re.compile(r'^【系统提示[：:](.+?)】$')

# OS line: "角色名(OS)：内容"
OS_RE = re.compile(r'^(.+?)[（(]OS[）)][：:](.+)$')

# Dialogue line: "角色名(情绪)：台词" or "角色名：台词"
DIALOGUE_RE = re.compile(r'^([^▲【\s][^（(：:]+?)(?:[（(]([^）)]+)[）)])?[：:](.+)$')

# Parenthetical annotations to strip: (声音), (稍后入场), etc.
ANNOTATION_RE = re.compile(r'[（(][^）)]*[）)]')

# State annotation: 【幼年】【战甲】
STATE_RE = re.compile(r'【(.+?)】')

# Group / extra patterns — never get individual actor IDs
GROUP_RE = re.compile(
    r'[×x]\d+|若干|众人$|等人$|们$|群$|大军$|大队$|弟子$|双胞胎|三胞胎|兄弟俩|姐妹俩'
)

# Chinese separators shared across actor/prop/state parsing
SEPARATOR_RE = re.compile(r'[、，,;；]')

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

NON_CHARACTER = {'旁白', '字幕', '系统提示'}


# ---------- Helpers ----------

def clean_name(name: str) -> str:
    """Remove parenthetical annotations from name."""
    return ANNOTATION_RE.sub('', name).strip()


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
        for segment in SEPARATOR_RE.split(layer):
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

    for name in SEPARATOR_RE.split(raw):
        cleaned = name.strip()
        if cleaned and cleaned not in seen:
            props.append(cleaned)
            seen.add(cleaned)

    return props


def fmt_id(n: int) -> str:
    """Format number as zero-padded 3-digit string."""
    return str(n).zfill(3)


# ---------- Catalog / Design loaders ----------

class CatalogMappings:
    """Container for catalog.json mappings."""
    def __init__(self):
        self.actor_ids: Dict[str, str] = {}  # name|alias → id
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
        """Register primary name + aliases for an asset."""
        asset_id = entry['id']
        registry[entry['name']] = asset_id
        for alias in entry.get('aliases', []):
            if alias and alias not in registry:
                registry[alias] = asset_id

    # Load actors
    for i, actor in enumerate(data.get('actors', [])):
        actor_id = actor.get('id', f"act_{fmt_id(i + 1)}")
        actor['id'] = actor_id
        register_names(catalog.actor_ids, actor)
        if actor.get('states'):
            catalog.actor_states[actor['name']] = load_states(actor_id, actor['states'])
        if actor.get('description'):
            catalog.descriptions[actor_id] = actor['description']

    # Load locations
    for i, loc in enumerate(data.get('locations', [])):
        loc_id = loc.get('id', f"loc_{fmt_id(i + 1)}")
        loc['id'] = loc_id
        register_names(catalog.loc_ids, loc)
        if loc.get('states'):
            load_states(loc_id, loc['states'])
        if loc.get('description'):
            catalog.descriptions[loc_id] = loc['description']

    # Load props
    for i, prop in enumerate(data.get('props', [])):
        prop_id = prop.get('id', f"prp_{fmt_id(i + 1)}")
        prop['id'] = prop_id
        register_names(catalog.prop_ids, prop)
        if prop.get('states'):
            load_states(prop_id, prop['states'])
        if prop.get('description'):
            catalog.descriptions[prop_id] = prop['description']

    return catalog


def load_design_fields(project_path: Path) -> Dict[str, str]:
    """Load design.json fields (title, style, worldview)."""
    design_path = project_path / 'draft' / 'design.json'

    try:
        with open(design_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            'title': data.get('title', ''),
            'style': data.get('style', ''),
            'worldview': data.get('worldview', ''),
        }
    except (FileNotFoundError, json.JSONDecodeError):
        return {'title': '', 'style': '', 'worldview': ''}


# ---------- Core parser ----------

def parse_episodes(project_path: Path) -> Dict[str, Any]:
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

    def register_actor(name: str) -> Optional[str]:
        """Register actor and return its ID, or None if unresolved."""
        nonlocal actor_counter
        if not name or is_group(name) or name in NON_CHARACTER:
            return None
        if name in actors:
            return actors[name]
        if catalog.has_catalog:
            unresolved_actors.add(name)
            return None
        actor_counter += 1
        aid = f'act_{fmt_id(actor_counter)}'
        actors[name] = aid
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

    def warn_unknown_actor_state(name: str, state: str) -> None:
        """Warn if actor state is not listed in catalog.json."""
        if name in catalog.actor_states and state not in catalog.actor_states[name]:
            print(
                f"⚠️  Warning: Actor '{name}' state '{state}' not in catalog.json states: {json.dumps(catalog.actor_states[name])}",
                file=sys.stderr
            )

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
    ) -> None:
        """Add action to scene."""
        action: Dict[str, Any] = {'type': action_type, 'content': content}
        if actor_id:
            action['actor_id'] = actor_id
        if emotion:
            action['emotion'] = emotion
        scene['actions'].append(action)

    # Main parsing loop
    for ep_file in ep_files:
        with open(ep_file, 'r', encoding='utf-8') as f:
            text = f.read()

        for line in text.split('\n'):
            stripped = line.strip()
            if not stripped:
                continue

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
                flush_scene()
                scn_counter += 1
                ep_scn_counter += 1

                loc_name = m.group(5).strip()
                loc_state_name = m.group(6).strip() if m.group(6) else None
                loc_id = register_location(loc_name)
                space = SPACE_MAP.get(m.group(4), m.group(4))
                time = TIME_MAP.get(m.group(3), m.group(3))

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

                continue

            if not current_scene:
                continue

            # 2. Actor line
            m = CHAR_LINE_RE.match(stripped)
            if m:
                for name, state in parse_actor_line(m.group(1)):
                    cid = register_actor(name)
                    if cid:
                        if state:
                            warn_unknown_actor_state(name, state)
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
                for entry in SEPARATOR_RE.split(m.group(1)):
                    name, state = extract_state(entry)
                    if not name or not state:
                        continue

                    # Try actor first
                    cid = actors.get(name) or register_actor(name)
                    if cid:
                        warn_unknown_actor_state(name, state)
                        scene_actor_states[scn_counter].append((cid, state))
                        register_scene_actor(scn_counter, cid, state)
                continue

            # 4. Subtitle
            m = SUBTITLE_RE.match(stripped)
            if m:
                add_action(current_scene, 'sfx', m.group(1).strip())
                continue

            # 5. System prompt
            m = SYSTEM_RE.match(stripped)
            if m:
                add_action(current_scene, 'sfx', m.group(1).strip())
                continue

            # 6. Action line
            m = ACTION_LINE_RE.match(stripped)
            if m:
                add_action(current_scene, 'action', m.group(1).strip())
                continue

            # 7. OS line (check before dialogue)
            m = OS_RE.match(stripped)
            if m:
                cleaned = clean_name(m.group(1))
                cid = register_actor(cleaned)
                if cid:
                    register_scene_actor(scn_counter, cid, None)
                add_action(current_scene, 'inner_thought', m.group(2).strip(), cid)
                continue

            # 8. Dialogue line
            m = DIALOGUE_RE.match(stripped)
            if m:
                cleaned = clean_name(m.group(1))
                if cleaned.startswith('【') or cleaned in NON_CHARACTER:
                    continue
                cid = register_actor(cleaned)
                if cid:
                    register_scene_actor(scn_counter, cid, None)
                emotion = m.group(2).strip() if m.group(2) else None
                add_action(current_scene, 'dialogue', m.group(3).strip(), cid, emotion)
                continue

    flush_episode()

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

    actor_ids_sorted = sorted(actor_canonical.keys())
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
                state_id = state_id_map.get(f'{aid}|{state_name}') if state_name else None
                actor_entries.append({'actor_id': aid, 'state_id': state_id})

            scene['actors'] = actor_entries

    # Build locations list with state IDs (continue global state_counter)
    # Deduplicate aliases
    loc_state_id_map: Dict[str, str] = {}
    loc_canonical: Dict[str, str] = {}
    for name, lid in locations.items():
        if lid not in loc_canonical:
            loc_canonical[lid] = name

    loc_ids_sorted = sorted(loc_canonical.keys())
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

    prop_ids_sorted = sorted(prop_canonical.keys())
    props_list: List[Dict[str, Any]] = []

    for pid in prop_ids_sorted:
        name = prop_canonical[pid]
        entry: Dict[str, Any] = {'prop_id': pid, 'prop_name': name}

        if pid in catalog.descriptions:
            entry['description'] = catalog.descriptions[pid]

        props_list.append(entry)

    # Resolve scene.locations[*].state_id and scene.props
    # (separate pass needed: loc_state_id_map built above)
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
    output_dir = project_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)
    script_path = output_dir / 'script.json'

    with open(script_path, 'w', encoding='utf-8') as f:
        json.dump(script_data, f, ensure_ascii=False, indent=2)

    total_scenes = sum(len(ep['scenes']) for ep in episodes)

    # Build unresolved warnings
    warnings: List[str] = []
    if unresolved_actors:
        warnings.append(
            f"Unresolved actors (not in catalog.json, skipped): {', '.join(sorted(unresolved_actors))}. "
            f"Add them to catalog.json actors[] or as aliases."
        )
    if unresolved_locations:
        warnings.append(
            f"Unresolved locations (not in catalog.json, skipped): {', '.join(sorted(unresolved_locations))}. "
            f"Add them to catalog.json locations[] or as aliases."
        )
    if unresolved_props:
        warnings.append(
            f"Unresolved props (not in catalog.json, skipped): {', '.join(sorted(unresolved_props))}. "
            f"Add them to catalog.json props[] or as aliases."
        )

    for w in warnings:
        print(f'⚠️  {w}', file=sys.stderr)

    return {
        'script_path': str(script_path),
        'stats': {
            'total_scenes': total_scenes,
            'total_actors': len(actors_list),
            'total_locations': len(locations_list),
            'total_episodes': len(episodes),
            'episodes_parsed': len(ep_files),
        },
        **({'warnings': warnings} if warnings else {}),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Parse episode scripts and generate script.json'
    )
    parser.add_argument(
        '--project-path',
        required=True,
        help='Path to project directory containing draft/ and output/'
    )
    args = parser.parse_args()

    project_path = Path(args.project_path).resolve()
    result = parse_episodes(project_path)

    print(json.dumps(result, ensure_ascii=False, indent=2))

