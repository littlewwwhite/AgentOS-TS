"""
Phase 1：剧本名词提取 — 从 script.json 提取专有名词和对白文本，生成字幕指南
用法：python phase1_glossary.py <script.json路径> --episode ep_001 --ep-dir output/ep001
输出：output/ep00x/_tmp/glossary.json
"""

import json
import sys
import argparse
from pathlib import Path

# 从 styles.py 导入统一的语言检测
from styles import detect_language, get_language_config, get_supported_languages


def extract_glossary(script_path: str, episode_id: str, force_language: str = None) -> dict:
    """从 script.json 提取指定剧集的专有名词和对白"""
    with open(script_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 提取专有名词
    proper_nouns = []

    # 角色名
    for actor in data.get("actors", []):
        name = actor.get("actor_name", "")
        if name:
            proper_nouns.append(name)

    # 地点名
    for loc in data.get("locations", []):
        name = loc.get("location_name", "")
        if name:
            proper_nouns.append(name)

    # 道具名
    for prop in data.get("props", []):
        name = prop.get("prop_name", "")
        if name:
            proper_nouns.append(name)

    # 提取指定剧集的对白
    dialogues = []
    target_ep = None

    for ep in data.get("episodes", []):
        if ep.get("episode_id") == episode_id:
            target_ep = ep
            break

    if target_ep is None:
        print(f"Warning: 未找到剧集 {episode_id}，将提取所有剧集的对白")
        episodes = data.get("episodes", [])
    else:
        episodes = [target_ep]

    for ep in episodes:
        for scene in ep.get("scenes", []):
            for action in scene.get("actions", []):
                if action.get("type") == "dialogue":
                    text = action.get("content", "").strip()
                    if text:
                        dialogues.append(text)

    # 检测语言
    all_texts = proper_nouns + dialogues
    language = force_language if force_language else detect_language(all_texts)

    # 获取语言配置
    lang_config = get_language_config(language)

    result = {
        "episode_id": episode_id,
        "language": language,
        "language_name": lang_config.get("name", language),
        "proper_nouns": proper_nouns,
        "dialogues": dialogues,
    }

    return result


def main():
    parser = argparse.ArgumentParser(description="Phase 1: 剧本名词提取")
    parser.add_argument("script_path", help="script.json 文件路径")
    parser.add_argument("--episode", default="ep_001", help="剧集 ID（默认 ep_001）")
    parser.add_argument("--ep-dir", default=None, help="剧集输出目录（如 output/ep001），中间产物放 _tmp/ 下")
    parser.add_argument("--language", default=None, help=f"强制指定语言，可选: {', '.join(get_supported_languages())}")
    args = parser.parse_args()

    if not Path(args.script_path).exists():
        print(f"Error: 找不到剧本文件: {args.script_path}")
        sys.exit(1)

    glossary = extract_glossary(args.script_path, args.episode, force_language=args.language)

    # 确定输出路径：优先 ep-dir/_tmp/glossary.json，否则 output/glossary-{ep}.json
    if args.ep_dir:
        tmp_dir = Path(args.ep_dir) / "_tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        output_path = tmp_dir / "glossary.json"
    else:
        output_dir = Path.cwd() / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"glossary-{args.episode}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(glossary, f, ensure_ascii=False, indent=2)

    print(f"Glossary 提取完成:")
    print(f"  语言: {glossary['language_name']} ({glossary['language']})")
    print(f"  专有名词: {len(glossary['proper_nouns'])} 个")
    print(f"  对白文本: {len(glossary['dialogues'])} 条")
    print(f"  输出: {output_path}")


if __name__ == "__main__":
    main()
