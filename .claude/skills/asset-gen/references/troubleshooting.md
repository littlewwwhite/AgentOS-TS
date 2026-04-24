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
| Gemini API key invalid / 401 | ChatFire key expired or proxy config wrong | Check `assets/common/gemini_backend.json`: default should be `mode: "proxy"` + ChatFire `base_url`; verify `GEMINI_API_KEY` is set to the ChatFire key |
| Gemini config not taking effect | Edited wrong config file | The ONLY config file is `assets/common/gemini_backend.json` — NOT `generation_config.json` (legacy file, deleted) |
| Image generation timeout | API slow or queue congestion | Re-run directly; checkpoint resume skips completed items |
| All reviews rejected (max rounds) | Prompt-style mismatch | Use option 4 to review/modify prompts, then regenerate |
| Gemini review failure defaults to pass | Gemini API rate-limited or network issue | No impact on results; quality review is skipped |
| Submit failure | OpenAI-compatible image key missing, invalid, rate-limited, or quota exhausted | Check `OPENAI_API_KEY`, account quota, and retry |
| Character subject creation failed | Missing front-view URL | Check if three-view split succeeded; regenerate if needed |

## Checkpoint Resume

Step 3 supports checkpoint resume:
- **Characters**: Already in `output/actors/actors.json` -> auto-skipped
- **Scenes**: Already in `output/locations/locations.json` -> auto-skipped
- **Props**: Already in `output/props/props.json` -> auto-skipped

Re-run the same command after interruption. Use `--regenerate-*` to force regeneration.
