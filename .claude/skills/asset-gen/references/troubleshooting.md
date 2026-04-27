# Troubleshooting

## Log Location

Each step 3 execution generates timestamped logs in `draft/logs/`:
- Characters: `actors_gen_YYYYMMDD_HHMMSS.log`
- Scenes: `scenes_gen_YYYYMMDD_HHMMSS.log`
- Props: `props_gen_YYYYMMDD_HHMMSS.log`

View latest logs:
```bash
ls -lt draft/logs/ | head -5
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `python: command not found` | macOS only has `python3` | Scripts use `sys.executable` internally; always invoke via `python3 -X utf8` from SKILL.md |
| Text/JSON model preflight fails | aos-cli model provider config or API key is missing/invalid | Run `uv run --project aos-cli aos-cli model preflight --json`; verify the provider-specific env vars configured for `aos-cli model` |
| aos-cli model config not taking effect | Edited wrong config file | The legacy-named model config is `assets/common/gemini_backend.json` — NOT `generation_config.json` (legacy file, deleted) |
| Image generation timeout | API slow or queue congestion | Re-run directly; checkpoint resume skips completed items |
| All reviews rejected (max rounds) | Prompt-style mismatch | Use option 4 to review/modify prompts, then regenerate |
| Gemini review failure defaults to pass | Gemini API rate-limited or network issue | No impact on results; quality review is skipped |
| Image submit failure | aos-cli image provider config missing, invalid, rate-limited, or quota exhausted | Run `uv run --project aos-cli aos-cli model preflight --json`; verify the configured image provider env vars and optional `ASSET_IMAGE_MODEL` |
| Character subject creation failed | Missing front-view URL | Check if three-view split succeeded; regenerate if needed |

## Checkpoint Resume

Step 3 supports checkpoint resume:
- **Characters**: Already in `output/actors/actors.json` -> auto-skipped
- **Scenes**: Already in `output/locations/locations.json` -> auto-skipped
- **Props**: Already in `output/props/props.json` -> auto-skipped

Re-run the same command after interruption. Use `--regenerate-*` to force regeneration.
