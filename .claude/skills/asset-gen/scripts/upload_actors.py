#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
upload_actors.py - 校验 actors.json 并上传角色资产到平台

流程:
  1. 读取 output/actors/actors.json
  2. 校验每个角色必填字段: voice, voice_url, three_view, three_view_url 非空, subject_id 为空
  3. 为每个角色创建素材组合（团队）
  4. 上传角色资产（三视图、语音等）到对应组合
"""

import argparse, json, sys, urllib.parse
from pathlib import Path

# ── 路径常量 ──────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent

# ── 导入 common_asset_group_api ───────────────────────────────────────────
sys.path.insert(0, str(SCRIPT_DIR))
import common_asset_group_api as api


# ═══════════════════════════════════════════════════════════════════════════
# 校验
# ═══════════════════════════════════════════════════════════════════════════

REQUIRED_FIELDS = ["voice", "voice_url"]
REQUIRED_DEFAULT_FIELDS = ["three_view", "three_view_url"]


def validate_actors(actors: dict) -> tuple[list[str], list[str]]:
    """
    校验 actors.json 内容，返回 (错误列表, 已跳过角色列表)。

    规则:
      - voice, voice_url 必须非空
      - default.three_view, default.three_view_url 必须非空
      - default.subject_id 非 null 的角色视为已上传，自动跳过
    """
    errors = []
    skipped = []
    for act_id, actor in actors.items():
        name = actor.get("name", act_id)
        # subject_id 非空 → 已上传，跳过
        default = actor.get("default")
        if default and default.get("subject_id") is not None:
            skipped.append(f"{name}({act_id})")
            continue
        # 顶层字段
        for field in REQUIRED_FIELDS:
            val = actor.get(field)
            if not val:
                errors.append(f"[{name}({act_id})] 缺少必填字段: {field}")
        # default 子对象
        if not default:
            errors.append(f"[{name}({act_id})] 缺少 default 对象")
            continue
        for field in REQUIRED_DEFAULT_FIELDS:
            val = default.get(field)
            if not val:
                errors.append(f"[{name}({act_id})] default 缺少必填字段: {field}")
    return errors, skipped


# ═══════════════════════════════════════════════════════════════════════════
# URL 处理
# ═══════════════════════════════════════════════════════════════════════════

def _cos_url_to_key(url: str) -> str:
    """
    将 COS 完整签名 URL 转换为相对路径。
    https://huimeng-xxx.cos.ap-beijing.myqcloud.com/material/image-draw/.../file.png?sign=...
    → material/image-draw/.../file.png
    如果已经是相对路径则直接返回。
    """
    if not url or not url.startswith("http"):
        return url
    parsed = urllib.parse.urlparse(url)
    return parsed.path.lstrip("/")


# ═══════════════════════════════════════════════════════════════════════════
# 上传流程
# ═══════════════════════════════════════════════════════════════════════════

# 每个角色要上传的资产映射: (资产名称, url取值函数, 回写到default的id字段名)
ASSET_MAP = [
    ("三视图", lambda actor: actor["default"]["three_view_url"],   "three_view_id"),
    ("正面",   lambda actor: actor["default"].get("face_view_url", ""),  "face_view_id"),
    ("侧面",   lambda actor: actor["default"].get("side_view_url", ""),  "side_view_id"),
    ("背面",   lambda actor: actor["default"].get("back_view_url", ""),  "back_view_id"),
    # ("语音",   lambda actor: actor.get("voice_url", ""),                "voice_id"),
]


def _extract_asset_id(data) -> str:
    """从 create_asset 返回值中提取资产 ID。"""
    if isinstance(data, dict):
        return data.get("id") or data.get("assetId") or ""
    return str(data) if data else ""


def upload_actors(target_actors: dict, actors_json_path: Path, all_actors: dict = None):
    """为每个角色创建素材组合并上传资产，跳过已上传角色，每个角色处理完立即回写 actors.json。"""
    if all_actors is None:
        all_actors = target_actors
    results = {}
    for act_id, actor in target_actors.items():
        # 跳过已上传的角色
        default = actor.get("default", {})
        if default.get("subject_id") is not None:
            continue
        name = actor.get("name", act_id)
        if "default" not in actor:
            actor["default"] = {}
        default = actor["default"]
        print(f"\n{'='*60}", flush=True)
        print(f"处理角色: {name} ({act_id})", flush=True)
        print(f"{'='*60}", flush=True)

        # 1. 创建素材组合
        group_id = api.create_asset_group(
            name=name,
            description=f"角色 {name} 的资产组合",
        )
        if not group_id:
            print(f"  ❌ 创建素材组合失败，跳过角色 {name}", flush=True)
            results[act_id] = {"name": name, "success": False, "error": "创建组合失败"}
            continue

        print(f"  ✓ 素材组合ID: {group_id}", flush=True)

        # 2. 上传资产并回写 id
        uploaded = []
        failed = []
        for asset_name, url_getter, id_field in ASSET_MAP:
            url = _cos_url_to_key(url_getter(actor))
            if not url:
                print(f"  ⏭ 跳过空资产: {asset_name}", flush=True)
                continue
            result = api.create_asset(
                asset_groups_id=group_id,
                url=url,
                name=f"{name}-{asset_name}",
            )
            if result:
                asset_id = _extract_asset_id(result)
                default[id_field] = asset_id
                print(f"  ✓ {asset_name} → {id_field}={asset_id}", flush=True)
                uploaded.append(asset_name)
            else:
                failed.append(asset_name)

        # 3. three_view_id 同步写入 subject_id
        three_view_id = default.get("three_view_id")
        if three_view_id:
            default["subject_id"] = three_view_id
            print(f"  ✓ subject_id={three_view_id}", flush=True)

        results[act_id] = {
            "name": name,
            "success": len(failed) == 0,
            "group_id": group_id,
            "uploaded": uploaded,
            "failed": failed,
        }
        print(f"\n  结果: 上传 {len(uploaded)} 项, 失败 {len(failed)} 项", flush=True)

        # 单个角色处理完立即回写 actors.json
        with open(actors_json_path, "w", encoding="utf-8") as f:
            json.dump(all_actors, f, ensure_ascii=False, indent=2)
        print(f"  ✓ 已回写 actors.json", flush=True)

    return results


# ═══════════════════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════════════════

def _resolve_project_dir(cli_value: str | None) -> Path:
    """Resolve project directory from CLI arg, env var, or CWD (in that order)."""
    import os
    if cli_value:
        return Path(cli_value).resolve()
    env = os.environ.get("PROJECT_DIR")
    if env:
        return Path(env).resolve()
    return Path.cwd()


def main():
    parser = argparse.ArgumentParser(description="上传角色资产到平台")
    parser.add_argument("--project-dir", type=str, default=None,
                        help="Project root directory (default: PROJECT_DIR env var or CWD)")
    parser.add_argument("--actors", type=str, default="",
                        help="指定要上传的角色名，逗号分隔（如 'Driver,Boy'）。为空则上传全部未上传角色。")
    args = parser.parse_args()

    project_dir = _resolve_project_dir(args.project_dir)
    actors_json_path = project_dir / "output" / "actors" / "actors.json"

    # 解析指定角色名
    specified_names = set()
    if args.actors:
        specified_names = {n.strip() for n in args.actors.split(",") if n.strip()}

    # 1. 读取 actors.json
    print(f"读取 actors.json: {actors_json_path}", flush=True)
    if not actors_json_path.exists():
        print(f"❌ 文件不存在: {actors_json_path}", flush=True)
        sys.exit(1)

    with open(actors_json_path, "r", encoding="utf-8") as f:
        actors = json.load(f)

    # 如果指定了角色名，过滤出对应角色
    if specified_names:
        filtered = {aid: a for aid, a in actors.items() if a.get("name") in specified_names}
        not_found = specified_names - {a.get("name") for a in filtered.values()}
        if not_found:
            print(f"⚠ 未找到角色: {', '.join(not_found)}", flush=True)
        if not filtered:
            print("❌ 没有匹配的角色", flush=True)
            sys.exit(1)
        print(f"指定上传角色: {', '.join(specified_names)}", flush=True)
        print(f"共匹配 {len(filtered)} 个角色\n", flush=True)
        target_actors = filtered
    else:
        print(f"共 {len(actors)} 个角色\n", flush=True)
        target_actors = actors

    # 2. 校验
    print("── 校验必填字段 ──", flush=True)
    errors, skipped = validate_actors(target_actors)
    if skipped:
        print(f"⏭ 已上传角色（跳过）: {', '.join(skipped)}", flush=True)
    if errors:
        print("❌ 校验失败:", flush=True)
        for err in errors:
            print(f"  - {err}", flush=True)
        sys.exit(1)
    # 检查是否还有需要上传的角色
    pending = [a.get("name", aid) for aid, a in target_actors.items()
               if a.get("default", {}).get("subject_id") is None]
    if not pending:
        print("✓ 所有角色均已上传，无需操作\n", flush=True)
        sys.exit(0)
    print(f"✓ 待上传角色: {', '.join(pending)}\n", flush=True)

    # 3. 创建团队并上传资产（传入完整 actors 用于回写，但只处理 target）
    print("── 创建团队并上传资产 ──", flush=True)
    results = upload_actors(target_actors, actors_json_path, actors)

    # 4. 汇总
    print(f"\n{'='*60}", flush=True)
    print("上传汇总:", flush=True)
    print(f"{'='*60}", flush=True)
    all_success = True
    for act_id, r in results.items():
        status = "✓" if r["success"] else "❌"
        print(f"  {status} {r['name']}({act_id}): group_id={r.get('group_id', 'N/A')}, "
              f"上传={r.get('uploaded', [])}, 失败={r.get('failed', [])}", flush=True)
        if not r["success"]:
            all_success = False

    if all_success:
        print("\n✓ 全部上传成功!", flush=True)
    else:
        print("\n⚠ 部分上传失败，请检查日志", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
