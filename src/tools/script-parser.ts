// input: episodes/ep*.md files in 场记格式
// output: script.json (structured screenplay with nested episodes > scenes > actions)
// pos: Deterministic parser — extracts structural data from formatted scripts, no LLM

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

// ---------- Regex patterns ----------

// Scene header: "1-1 日 内 觉醒大厅"
const SCENE_HEADER_RE =
  /^(\d+)-(\d+)\s+(日|夜|清晨|黄昏|午后|凌晨|夜晚|深夜|黎明|白天|傍晚|中午)\s+(内|外)\s+([^【]+?)(?:【(.+?)】)?\s*$/;

// Episode header: "第N集" or "# 第 N 集：标题"
const EPISODE_HEADER_RE = /^#?\s*第\s*(\d+)\s*集(?:[：:]\s*(.+?))?$/;

// Actor line: "人物：角色A、角色B"
const CHAR_LINE_RE = /^人物[：:](.+)$/;

// Prop line: "道具：断剑、玉佩"
const PROP_LINE_RE = /^道具[：:](.+)$/;

// Action line: ▲动作描述
const ACTION_LINE_RE = /^▲(.+)$/;

// Subtitle: 【字幕：内容】
const SUBTITLE_RE = /^【字幕[：:](.+?)】$/;

// System prompt: 【系统提示：内容】
const SYSTEM_RE = /^【系统提示[：:](.+?)】$/;

// OS line: "角色名（OS）：内容"
const OS_RE = /^(.+?)[（(]OS[）)][：:](.+)$/;

// Dialogue line: "角色名（情绪）：台词" or "角色名：台词"
const DIALOGUE_RE = /^([^▲【\s][^（(：:]+?)(?:[（(]([^）)]+)[）)])?[：:](.+)$/;

// Parenthetical annotations to strip: （声音）, （稍后入场）, etc.
const ANNOTATION_RE = /[（(][^）)]*[）)]/g;

// State annotation: 【幼年】【战甲】
const STATE_RE = /【(.+?)】/;

// Group / extra patterns — never get individual actor IDs
const GROUP_RE = /[×x]\d+|若干|众人$|等人$|们$|群$|大军$|大队$|弟子$/;

// NPC layer label
const NPC_LAYER_RE = /NPC[：:]/;

// Non-NPC layer labels to strip
const LAYER_LABEL_RE = /(?:配角|龙套)[：:]/;

// Time word → English mapping
const TIME_MAP: Record<string, string> = {
  日: "day",
  白天: "day",
  夜: "night",
  夜晚: "night",
  深夜: "night",
  清晨: "dawn",
  黎明: "dawn",
  凌晨: "dawn",
  午后: "noon",
  中午: "noon",
  黄昏: "dusk",
  傍晚: "dusk",
};

const NON_CHARACTER = new Set(["旁白", "字幕", "系统提示"]);

// ---------- Helpers ----------

function cleanName(name: string): string {
  return name.replace(ANNOTATION_RE, "").trim();
}

function extractState(name: string): [string, string | null] {
  const m = STATE_RE.exec(name);
  const state = m ? m[1] : null;
  const stripped = name.replace(STATE_RE, "");
  return [cleanName(stripped), state];
}

function isGroup(name: string): boolean {
  return GROUP_RE.test(name);
}

function parseActorLine(raw: string): Array<[string, string | null]> {
  const results: Array<[string, string | null]> = [];
  const layers = raw.split("/");
  for (let layer of layers) {
    layer = layer.trim();
    if (NPC_LAYER_RE.test(layer)) {
      layer = layer.replace(/NPC[：:].*$/, "").trim();
      if (!layer) continue;
    }
    layer = layer.replace(LAYER_LABEL_RE, "");
    for (const name of layer.split(/[、，,;；]/)) {
      const [cleaned, state] = extractState(name);
      if (cleaned && !isGroup(cleaned)) {
        results.push([cleaned, state]);
      }
    }
  }
  return results;
}

function parsePropLine(raw: string): string[] {
  const props: string[] = [];
  const seen = new Set<string>();
  for (const name of raw.split(/[、，,;；]/)) {
    const cleaned = name.trim();
    if (cleaned && !seen.has(cleaned)) {
      props.push(cleaned);
      seen.add(cleaned);
    }
  }
  return props;
}

// ---------- Catalog / Design loaders ----------

interface CatalogMappings {
  actorIds: Record<string, string>;
  locIds: Record<string, string>;
  actorStates: Record<string, string[]>;
  propIds: Record<string, string>;
}

async function loadCatalogMappings(projectPath: string): Promise<CatalogMappings> {
  const empty: CatalogMappings = { actorIds: {}, locIds: {}, actorStates: {}, propIds: {} };
  const catalogPath = path.join(projectPath, "draft", "catalog.json");
  try {
    const raw = await fs.readFile(catalogPath, "utf-8");
    const data = JSON.parse(raw);
    const actorIds: Record<string, string> = {};
    const actorStates: Record<string, string[]> = {};
    for (const c of data.actors ?? []) {
      actorIds[c.name] = c.id;
      if (c.states?.length) actorStates[c.name] = c.states;
    }
    const locIds: Record<string, string> = {};
    for (const loc of data.locations ?? []) locIds[loc.name] = loc.id;
    const propIds: Record<string, string> = {};
    for (const p of data.props ?? []) propIds[p.name] = p.id;
    return { actorIds, locIds, actorStates, propIds };
  } catch {
    return empty;
  }
}

async function loadDesignFields(
  projectPath: string,
): Promise<{ title: string; style: string; worldview: string }> {
  const designPath = path.join(projectPath, "draft", "design.json");
  try {
    const raw = await fs.readFile(designPath, "utf-8");
    const data = JSON.parse(raw);
    return {
      title: data.title ?? "",
      style: data.style ?? "",
      worldview: data.worldview ?? "",
    };
  } catch {
    return { title: "", style: "", worldview: "" };
  }
}

// ---------- Core parser ----------

interface ParsedAction {
  sequence: number;
  type: string;
  content: string;
  actor_id?: string;
  emotion?: string;
}

interface ParsedScene {
  id: string;
  sequence: number;
  location: string;
  location_id: string;
  time_of_day: string;
  cast: Array<{ actor_id: string; state_id: string | null }>;
  prop_ids: string[];
  actions: ParsedAction[];
  location_state_id?: string;
}

interface ParsedEpisode {
  episode: number;
  title: string | null;
  scenes: ParsedScene[];
}

export async function parseEpisodes(
  projectPath: string,
): Promise<Record<string, unknown>> {
  const episodesDir = path.join(projectPath, "draft", "episodes");

  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(episodesDir);
  } catch {
    return { error: `Directory not found: ${episodesDir}` };
  }

  const epFiles = dirEntries
    .filter((f) => /^ep.*\.md$/i.test(f))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const nb = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return na - nb;
    })
    .map((f) => path.join(episodesDir, f));

  if (epFiles.length === 0) {
    return { error: `No ep*.md files in ${episodesDir}` };
  }

  // Load external data
  const catalog = await loadCatalogMappings(projectPath);
  const design = await loadDesignFields(projectPath);

  // Actor state
  const actors: Record<string, string> = { ...catalog.actorIds };
  let actorCounter = Object.keys(catalog.actorIds).length;

  // Location state
  const locations: Record<string, string> = { ...catalog.locIds };
  let locCounter = Object.keys(catalog.locIds).length;

  // Prop state
  const props: Record<string, string> = { ...catalog.propIds };
  let propCounter = Object.keys(catalog.propIds).length;

  const locStateNames: Record<string, string[]> = {};
  const sceneLocStates: Record<number, [string, string] | null> = {};

  function registerLocation(name: string): string {
    if (locations[name]) return locations[name];
    locCounter++;
    const lid = `loc_${String(locCounter).padStart(3, "0")}`;
    locations[name] = lid;
    return lid;
  }

  function registerActor(name: string): string | null {
    if (!name || isGroup(name) || NON_CHARACTER.has(name)) return null;
    if (actors[name]) return actors[name];
    actorCounter++;
    const aid = `act_${String(actorCounter).padStart(3, "0")}`;
    actors[name] = aid;
    return aid;
  }

  function registerProp(name: string): string | null {
    const propName = name.trim();
    if (!propName) return null;
    if (props[propName]) return props[propName];
    propCounter++;
    const pid = `prp_${String(propCounter).padStart(3, "0")}`;
    props[propName] = pid;
    return pid;
  }

  // Track per-scene state annotations and cast
  const sceneActorStates: Record<number, Array<[string, string]>> = {};
  const sceneCast: Record<number, Record<string, string | null>> = {};

  function registerSceneCastMember(
    scnNum: number,
    actorId: string,
    stateName: string | null = null,
  ): void {
    const castMap = (sceneCast[scnNum] ??= {});
    if (!(actorId in castMap)) {
      castMap[actorId] = stateName;
      return;
    }
    if (castMap[actorId] === null && stateName !== null) {
      castMap[actorId] = stateName;
    }
  }

  // Parse
  const episodes: ParsedEpisode[] = [];
  let currentEpisode: ParsedEpisode | null = null;
  let currentScene: ParsedScene | null = null;
  let actionCounter = 0;
  let scnCounter = 0;

  function flushScene(): void {
    if (currentScene && currentEpisode) {
      currentEpisode.scenes.push(currentScene);
      currentScene = null;
    }
  }

  function flushEpisode(): void {
    flushScene();
    if (currentEpisode) {
      episodes.push(currentEpisode);
      currentEpisode = null;
    }
  }

  function addAction(
    scene: ParsedScene,
    actionType: string,
    content: string,
    actorId?: string,
    emotion?: string,
  ): void {
    actionCounter++;
    const action: ParsedAction = { sequence: actionCounter, type: actionType, content };
    if (actorId) action.actor_id = actorId;
    if (emotion) action.emotion = emotion;
    scene.actions.push(action);
  }

  for (const epFile of epFiles) {
    const text = await fs.readFile(epFile, "utf-8");
    for (const line of text.split("\n")) {
      const stripped = line.trim();
      if (!stripped) continue;

      // 0. Episode header
      let m = EPISODE_HEADER_RE.exec(stripped);
      if (m) {
        flushEpisode();
        currentEpisode = {
          episode: Number.parseInt(m[1], 10),
          title: m[2]?.trim() ?? null,
          scenes: [],
        };
        actionCounter = 0;
        continue;
      }

      // 1. Scene header
      m = SCENE_HEADER_RE.exec(stripped);
      if (m) {
        flushScene();
        scnCounter++;
        const locName = m[5].trim();
        const locStateName = m[6]?.trim() ?? null;
        const locId = registerLocation(locName);

        currentScene = {
          id: `scn_${String(scnCounter).padStart(3, "0")}`,
          sequence: Number.parseInt(m[2], 10),
          location: locName,
          location_id: locId,
          time_of_day: TIME_MAP[m[3]] ?? m[3],
          cast: [],
          prop_ids: [],
          actions: [],
        };

        if (locStateName) {
          sceneLocStates[scnCounter] = [locId, locStateName];
          if (!locStateNames[locId]) locStateNames[locId] = [];
          if (!locStateNames[locId].includes(locStateName)) {
            locStateNames[locId].push(locStateName);
          }
        } else {
          sceneLocStates[scnCounter] = null;
        }

        sceneActorStates[scnCounter] = [];
        sceneCast[scnCounter] = {};

        if (!currentEpisode) {
          currentEpisode = {
            episode: Number.parseInt(m[1], 10),
            title: null,
            scenes: [],
          };
          actionCounter = 0;
        }
        continue;
      }

      if (!currentScene) continue;

      // 2. Actor line
      m = CHAR_LINE_RE.exec(stripped);
      if (m) {
        for (const [name, state] of parseActorLine(m[1])) {
          const cid = registerActor(name);
          if (cid) {
            if (state) {
              if (name in catalog.actorStates) {
                if (!catalog.actorStates[name].includes(state)) {
                  console.warn(
                    `⚠️  Warning: Actor '${name}' state '${state}' not in catalog.json states: ${JSON.stringify(catalog.actorStates[name])}`,
                  );
                }
              }
              sceneActorStates[scnCounter].push([cid, state]);
              registerSceneCastMember(scnCounter, cid, state);
            } else {
              registerSceneCastMember(scnCounter, cid, null);
            }
          }
        }
        continue;
      }

      // 3. Prop line
      m = PROP_LINE_RE.exec(stripped);
      if (m) {
        for (const propName of parsePropLine(m[1])) {
          const pid = registerProp(propName);
          if (pid && !currentScene.prop_ids.includes(pid)) {
            currentScene.prop_ids.push(pid);
          }
        }
        continue;
      }

      // 4. Subtitle
      m = SUBTITLE_RE.exec(stripped);
      if (m) {
        addAction(currentScene, "sfx", m[1].trim());
        continue;
      }

      // 5. System prompt
      m = SYSTEM_RE.exec(stripped);
      if (m) {
        addAction(currentScene, "sfx", m[1].trim());
        continue;
      }

      // 6. Action line
      m = ACTION_LINE_RE.exec(stripped);
      if (m) {
        addAction(currentScene, "action", m[1].trim());
        continue;
      }

      // 7. OS line (check before dialogue)
      m = OS_RE.exec(stripped);
      if (m) {
        const cleaned = cleanName(m[1]);
        const cid = registerActor(cleaned);
        if (cid) registerSceneCastMember(scnCounter, cid, null);
        addAction(currentScene, "inner_thought", m[2].trim(), cid ?? undefined);
        continue;
      }

      // 8. Dialogue line
      m = DIALOGUE_RE.exec(stripped);
      if (m) {
        const cleaned = cleanName(m[1]);
        if (cleaned.startsWith("【") || NON_CHARACTER.has(cleaned)) continue;
        const cid = registerActor(cleaned);
        if (cid) registerSceneCastMember(scnCounter, cid, null);
        const emotion = m[2]?.trim() ?? undefined;
        addAction(currentScene, "dialogue", m[3].trim(), cid ?? undefined, emotion);
        continue;
      }
    }
  }

  flushEpisode();

  // ---------- Collect per-actor states ----------
  const actorStateNames: Record<string, string[]> = {};
  for (const aid of Object.values(actors)) actorStateNames[aid] = [];

  for (const ep of episodes) {
    for (const scene of ep.scenes) {
      const scnNum = Number.parseInt(scene.id.split("_")[1], 10);
      for (const [aid, stateName] of sceneActorStates[scnNum] ?? []) {
        if (aid in actorStateNames && !actorStateNames[aid].includes(stateName)) {
          actorStateNames[aid].push(stateName);
        }
      }
    }
  }

  // Build actors list with state IDs
  let stateCounter = 0;
  const stateIdMap: Record<string, string> = {}; // "aid|stateName" → stateId

  const actorEntries = Object.entries(actors);
  actorEntries.sort((a, b) => a[1].localeCompare(b[1]));
  const actorsList: Array<Record<string, unknown>> = [];

  for (const [name, aid] of actorEntries) {
    const statesForActor = actorStateNames[aid] ?? [];
    const entry: Record<string, unknown> = { id: aid, name };
    if (statesForActor.length > 0) {
      const statesList: Array<{ id: string; name: string }> = [];
      for (const stateName of statesForActor) {
        stateCounter++;
        const stateId = `st_${String(stateCounter).padStart(3, "0")}`;
        statesList.push({ id: stateId, name: stateName });
        stateIdMap[`${aid}|${stateName}`] = stateId;
      }
      entry.states = statesList;
    }
    actorsList.push(entry);
  }

  // Resolve scene.cast with concrete state IDs
  for (const ep of episodes) {
    for (const scene of ep.scenes) {
      const scnNum = Number.parseInt(scene.id.split("_")[1], 10);
      const castEntries: Array<{ actor_id: string; state_id: string | null }> = [];
      for (const [aid, stateName] of Object.entries(sceneCast[scnNum] ?? {})) {
        const stateId = stateName ? (stateIdMap[`${aid}|${stateName}`] ?? null) : null;
        castEntries.push({ actor_id: aid, state_id: stateId });
      }
      scene.cast = castEntries;
    }
  }

  // Build locations list with state IDs
  let locStateCounter = 0;
  const locStateIdMap: Record<string, string> = {};
  const locEntries = Object.entries(locations);
  locEntries.sort((a, b) => a[1].localeCompare(b[1]));
  const locationsList: Array<Record<string, unknown>> = [];

  for (const [name, lid] of locEntries) {
    const stateNamesForLoc = locStateNames[lid] ?? [];
    const entry: Record<string, unknown> = { id: lid, name };
    if (stateNamesForLoc.length > 0) {
      const statesList: Array<{ id: string; name: string }> = [];
      for (const stateName of stateNamesForLoc) {
        locStateCounter++;
        const locStateId = `lst_${String(locStateCounter).padStart(3, "0")}`;
        statesList.push({ id: locStateId, name: stateName });
        locStateIdMap[`${lid}|${stateName}`] = locStateId;
      }
      entry.states = statesList;
    }
    locationsList.push(entry);
  }

  // Build props list
  const propEntries = Object.entries(props);
  propEntries.sort((a, b) => a[1].localeCompare(b[1]));
  const propsList = propEntries.map(([name, pid]) => ({ id: pid, name }));

  // Resolve location_state_id in scenes
  for (const ep of episodes) {
    for (const scene of ep.scenes) {
      const scnNum = Number.parseInt(scene.id.split("_")[1], 10);
      const locState = sceneLocStates[scnNum];
      if (locState) {
        const [lid, stateName] = locState;
        const locStateId = locStateIdMap[`${lid}|${stateName}`];
        if (locStateId) scene.location_state_id = locStateId;
      }
    }
  }

  const scriptData = {
    title: design.title,
    worldview: design.worldview || null,
    style: design.style || null,
    actors: actorsList,
    locations: locationsList,
    props: propsList,
    episodes,
    metadata: {},
  };

  const outputDir = path.join(projectPath, "output");
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, "script.json");
  await fs.writeFile(scriptPath, JSON.stringify(scriptData, null, 2), "utf-8");

  const totalScenes = episodes.reduce((sum, ep) => sum + ep.scenes.length, 0);

  return {
    script_path: scriptPath,
    stats: {
      total_scenes: totalScenes,
      total_actors: actorsList.length,
      total_locations: locationsList.length,
      total_episodes: episodes.length,
      episodes_parsed: epFiles.length,
    },
  };
}

// ---------- MCP tool wrapper ----------

export const parseScript = tool(
  "parse_script",
  "Parse episodes/*.md into script.json (structured screenplay, deterministic, no LLM needed)",
  { project_path: z.string() },
  async ({ project_path }) => {
    const result = await parseEpisodes(project_path);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);
