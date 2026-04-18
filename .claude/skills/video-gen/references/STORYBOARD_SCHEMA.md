# Storyboard JSON Schema

## Data Hierarchy

```
Episode (集)
└── Scene (场)
    └── Shot (视频片段, 3-15s)
```

## Top-level Fields

- `title`: Episode title/summary
- `scenes`: Array of scenes

## Scene Level

| Field | Description |
|-------|-------------|
| `scene_id` | Scene ID |
| `actors` | All actor IDs in scene |
| `locations` | All location IDs in scene |
| `props` | All prop IDs in scene |
| `shots` | Array of generated-video shots |

## Shot Level

| Field | Description |
|-------|-------------|
| `source_refs` | 0-based action indexes from `scene.actions[]` used to build this shot |
| `prompt` | Canonical storyboard text for exactly one generated video, following the storyboard skill template |

## Prompt Contract

Each shot maps to exactly one generated video, so the canonical handoff fields are:

- **`source_refs`**: which lines in `scene.actions[]` were used
- **`prompt`**: the only video-generation prompt field

Legacy `clips`, `complete_prompt`, and `complete_prompt_v2` may still exist in historical files, but new outputs should not rely on them.
