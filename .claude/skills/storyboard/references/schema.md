# Storyboard `shots[]` schema

This is the persistent contract for `output/storyboard/{draft,approved}/ep{NNN}_storyboard.json`.

Authoritative spec: `docs/superpowers/specs/2026-04-28-storyboard-shot-schema-design.md`.

## Shape

```jsonc
{
  "episode_id": "ep001",
  "title": "...",
  "scenes": [
    {
      "scene_id": "scn_001",
      "shots": [
        {
          "id":       "scn_001_clip001",     // required, ^scn_\d{3}_clip\d{3}$
          "duration": 15,                    // required, integer in [4, 15]
          "prompt":   "...markdown text..."  // required, freeform markdown
        }
      ]
    }
  ]
}
```

The shot field set is exhaustive and minimal. Every field exists for one of:

- `id` — cross-stage addressing, file naming, regeneration targeting
- `duration` — directly maps to Ark Seedance 2.0 `duration` API parameter (int, 4–15s)
- `prompt` — natural-language container for everything else: scene description,
  Beats, Sx shot blocks, dialog, role state, camera, sfx. Visual asset references
  are declared **only** via `@xxx` tokens inside this field.

## What is NOT in the schema (and why)

| Removed field | Reason |
|---|---|
| `source_refs` | `@xxx` tokens already self-document provenance; redundant UI traceability |
| `actors[]` / `props[]` per-shot | Derived from prompt `@xxx` tokens; double-write violates single source of truth |
| `expected_duration` | Duplicate of `duration` |
| `reference_images[]` | Resolved at VIDEO runtime by `subject_resolver`; storyboard never persists URLs |
| `continuity` object | Continuity is a runtime concern (lsi, prev_video); injected into runtime storyboard, never written to approved |
| `locked` | Approval lives at directory level (draft/ vs approved/), not per-shot |
| `shot_type` / `camera_movement` / `time_of_day` | Content descriptors belong inside `prompt` markdown |

Adding any of these later requires re-justifying against the design's first principle:
*a field is allowed only when it's an Ark API parameter, OR a downstream-consumed structured value
that's prohibitively expensive to re-derive from `prompt`, OR an addressing handle.*

## Token reference protocol

`prompt` is the **single declaration channel** for visual asset references:

- Actors:    `@act_xxx` or `@act_xxx:st_yyy` (when actor has multiple registered states)
- Locations: `@loc_xxx`
- Props:     `@prp_xxx`

Tokens map to URLs at VIDEO runtime via `.claude/skills/video-gen/scripts/subject_resolver.py`,
which queries `output/{actors,locations,props}/*.json`. Storyboard JSON itself
**never holds URLs**.

Static appearance attributes (clothing, age, hairstyle, material) are **forbidden** in
prompt text; they live in the asset reference image, not the words. Prompt text describes
only dynamic state (position, emotion, visible cues).

## Finalize gate (draft → approved)

`apply_storyboard_result.py --finalize-stage` MUST run static `@token` validation
before promoting `output/storyboard/draft/ep{NNN}_storyboard.json` to
`output/storyboard/approved/ep{NNN}_storyboard.json`:

1. Scan all `scenes[].shots[].prompt` for `@act_xxx[:st_yyy]` / `@loc_xxx` / `@prp_xxx` tokens
2. For each token, resolve against the VISUAL stage manifest:
   - actor → `output/actors/actors.json` (and the `:st_yyy` suffix must exist as a registered state)
   - location → `output/locations/locations.json`
   - prop → `output/props/props.json`
3. If any token cannot be resolved, **fail-fast** with an explicit list of
   unresolved tokens; the draft does NOT advance to approved; pipeline-state
   stays at `partial`
4. Validation checks **only the binding's existence**, never URL reachability or
   image file presence. Asset library updates (re-rendered actor portraits, new
   location stills) propagate automatically to all not-yet-generated shots.

## Required structural validation rules

After scenes[] is generated and before draft is written:

1. **id format**: `^scn_\d{3}_clip\d{3}$`, scn portion matches parent `scene_id`
2. **id sequence**: shot indices in each scene start at 001, increment by 1, no gaps
3. **duration range**: integer in `[4, 15]` (Ark Seedance 2.0 API constraint)
4. **prompt non-empty**: `len(shot.prompt.strip()) > 0`
5. **no JSON in prompt**: no fenced code blocks; no `"key":` patterns; markdown only

These run at draft-write time. The `@token` validation in §finalize-gate runs
later, at draft → approved promotion.

## Relationship to `script.json`

```
script.json:                      output/storyboard/{draft,approved}/epNNN_storyboard.json:
  episodes[].scenes[]               scenes[]
    .actions[]  ──── inspires ────▶   .shots[]
       (prose, screenwriter fact)        (camera units, director fact)
```

- `actions[]` is screenwriter immutable input; storyboard reads it but **never modifies it**
- `shots[]` is the sole storyboard output, persisted in the storyboard JSON file
- N actions → M shots, no fixed ratio, no provenance pointers persisted in shot
  (the `@xxx` tokens that appear in shot prompts originate from the script's
  actor/location/prop registry, providing implicit traceability)

## Runtime view (for reference, not part of this contract)

VIDEO stage produces a runtime copy at `output/ep{NNN}/ep{NNN}_storyboard.json`
via `prepare_runtime_storyboard_export`. That copy MAY carry runtime-only fields:

- `lsi.url` / `lsi.video_url` — cross-run continuity carry-over
- `first_frame_url` / `last_frame_url` — i2v conditioning (mutex with reference_image route)

These fields are **runtime-injected and never written back to approved**. They
are not part of this schema and not validated by `apply_storyboard_result.py`.

## Example

```jsonc
{
  "episode_id": "ep001",
  "title": "冰水洗衣",
  "scenes": [
    {
      "scene_id": "scn_001",
      "shots": [
        {
          "id": "scn_001_clip001",
          "duration": 15,
          "prompt": "总体描述：阴暗潮湿的@loc_001内，钢蓝色调阴影与琥珀灯火交织。@act_001:st_001 在繁重劳作中坚韧。\n\n剧情摘要：@act_001:st_001 在冰水中揉搓披风遭@act_003 毒打。\n\n动作节拍 Beats：\n[0-3]  全景@loc_001破败潮湿\n[3-6]  特写@act_001:st_001 揉搓披风手背渗血\n[6-9]  @act_003 闯入一掌击倒@act_001:st_001\n[9-12] @act_001:st_001 摔污水中，@act_003 挥@prp_005 逼近\n[12-15] @act_003 俯视咒骂\n\nS1 | 00:00-00:03 | 全景/固定机位\n- 运镜：从灯笼缓慢拉开覆盖洗衣房空间\n- 动作：@act_001:st_001 跪木桶间双手揉搓\n- 角色状态：@act_001:st_001 跪石板地中央，坚毅\n- 音效：滴水声，木桶摩擦声\n- 对白：无\n\n... (S2–S5 omitted) ..."
        }
      ]
    }
  ]
}
```
