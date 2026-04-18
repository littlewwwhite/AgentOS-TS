# Language Configuration

## Language Auto-Detection

The system auto-detects video language and selects the corresponding font.

| Language Code | Language | Font |
|---------------|----------|------|
| zh | Simplified Chinese | Noto Sans CJK SC |
| zh-Hant | Traditional Chinese | Noto Sans CJK TC |
| ja | Japanese | Noto Sans CJK JP |
| ko | Korean | Noto Sans CJK KR |
| en | English | Noto Sans |

**Detection flow**:
1. Phase 1 detects language from script dialogues (CJK/kana/hangul/latin character ratio)
2. Language info stored in `glossary.json`, passed to Phase 2-5
3. Phase 4/5 selects CJK font based on language

**Force language override**:
```bash
# Phase 1
python3 phase1_glossary.py script.json --episode ep_001 --language ja

# Phase 2 (overrides glossary)
python3 phase2_transcribe.py video.mp4 --language en

# Phase 4/5
python3 phase4_burn.py video.mp4 sub.srt --language ja
```

## Full Language Table (`assets/languages.json`)

| Language Code | Name | Font |
|---------------|------|------|
| zh | Simplified Chinese | Noto Sans CJK SC |
| zh-Hant | Traditional Chinese | Noto Sans CJK TC |
| ja | Japanese | Noto Sans CJK JP |
| ko | Korean | Noto Sans CJK KR |
| en | English | Noto Sans |
| es | Spanish | Noto Sans |
| fr | French | Noto Sans |

**Extending**: Edit `assets/languages.json` to add new languages:

```json
{
  "ru": {
    "name": "Russian",
    "name_en": "Russian",
    "font": "Noto Sans",
    "asr_instruction": "Transcribe in Russian.",
    "detect": {...}
  }
}
```

**Detection flow**: Phase 1 detects language -> glossary.json -> Phase 2 ASR instruction -> Phase 4/5 font selection
