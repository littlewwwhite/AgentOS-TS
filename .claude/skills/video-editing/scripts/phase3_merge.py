"""
EP 级合并：scn 决策 → ep 成片

读取 Phase 2 输出的 scn 级 edit_decision.json（存放在 _tmp/scn{NNN}/），
合并为 ep 级 Premiere XML + ep mp4。

ep.mp4 从源文件直接拼接，不再依赖 Phase 2 的中间 mp4 文件。
_tmp/ 目录在合并完成后可清理。

用法:
  # 合并单集
  python phase3_merge.py output/ep001

  # 合并多集
  python phase3_merge.py output/ep001 output/ep002 output/ep003

输入:
  output/ep{NNN}/_tmp/scn{NNN}/edit_decision.json  — Phase 2 输出

输出:
  output/ep{NNN}/ep{NNN}.xml  — ep 级 Premiere XML
  output/ep{NNN}/ep{NNN}.mp4  — ep 级拼接视频

依赖: pip install python-dotenv scenedetect av
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# ── 配置加载 ──

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
ASSETS_DIR = SKILL_DIR / "assets"
DEFAULT_ENV = ASSETS_DIR / "default.env"

if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)

# ── 复用 Phase 2 的共享函数 ──

sys.path.insert(0, str(SCRIPT_DIR))
from phase2_assemble import (
    build_scn_video,
    generate_xmeml,
    probe_video_dimensions,
    refine_plan_cuts,
)


# ═══════════════════════ ep 级合并 ═══════════════════════


def merge_ep_outputs(ep_dir: Path) -> bool:
    """读取所有 scn 的 edit_decision.json，合并为 ep 级 XML + mp4。

    - ep XML：从所有 scn plan 合并生成（file 去重 + 相邻同源 shot 合并）
    - ep mp4：从源文件直接拼接（复用 Phase 2 的 build_scn_video）
    """
    ep_dir = ep_dir.resolve()
    ep_name = ep_dir.name

    # 收集所有 scn 的 edit_decision.json（从 _tmp/scn{NNN}/）
    decision_files = sorted(ep_dir.glob("_tmp/scn*/edit_decision.json"))
    if not decision_files:
        print(f"  警告: 未找到任何 edit_decision.json，跳过 ep 合并")
        return False

    # 合并所有 scn plan
    ep_plan = []
    scn_scores = []
    for df in decision_files:
        try:
            decision = json.loads(df.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  警告: 无法读取 {df}: {e}")
            continue

        scn_name = decision.get("scn", df.parent.name)
        scn_plan = decision.get("plan", [])
        scn_scores.append((scn_name, decision.get("final_score", 0)))
        ep_plan.extend(scn_plan)

    if not ep_plan:
        print(f"  警告: 合并后 plan 为空，跳过 ep 合并")
        return False

    print(f"\n{'='*60}")
    print(f"合并 ep: {ep_name}")
    print(f"  scn 数: {len(decision_files)}, 总 shot 数: {len(ep_plan)}")
    for scn_name, score in scn_scores:
        print(f"    {scn_name}: {score}/10")

    # 生成 ep XML（从合并 plan）
    vid_w, vid_h = 1280, 720
    for item in ep_plan:
        sp = item.get("source_path")
        if sp and Path(sp).exists():
            vid_w, vid_h = probe_video_dimensions(sp)
            break

    xml_content = generate_xmeml(ep_plan, ep_name, ep_name, width=vid_w, height=vid_h, base_dir=ep_dir)
    xml_path = ep_dir / f"{ep_name}.xml"
    xml_path.write_text(xml_content, encoding="utf-8")
    print(f"  ep XML 已保存: {xml_path}")

    # 生成 ep mp4（从源文件直接拼接）
    mp4_path = ep_dir / f"{ep_name}.mp4"
    refine_plan_cuts(ep_plan)

    print(f"  从源文件拼接 {len(ep_plan)} 个 shot...")
    t0 = time.time()
    ok, _, _ = build_scn_video(ep_plan, str(mp4_path))
    if not ok:
        print(f"  ep mp4 拼接失败")
        return False

    elapsed = time.time() - t0
    size_mb = mp4_path.stat().st_size / (1024 * 1024)
    print(f"  ep mp4 已保存: {mp4_path} ({size_mb:.1f} MB, {elapsed:.1f}s)")

    return True


# ═══════════════════════ CLI ═══════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="EP 级合并：scn 决策 → ep 成片",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 合并单集
  python phase3_merge.py output/ep001

  # 合并多集
  python phase3_merge.py output/ep001 output/ep002 output/ep003
        """,
    )
    parser.add_argument(
        "ep_dirs",
        nargs="+",
        help="ep 输出目录（如 output/ep001），可传多个",
    )
    args = parser.parse_args()

    success = 0
    failed = 0

    for ep_dir in args.ep_dirs:
        ep_path = Path(ep_dir)
        if not ep_path.exists():
            print(f"错误: 找不到路径: {ep_path}", file=sys.stderr)
            failed += 1
            continue

        try:
            ok = merge_ep_outputs(ep_path)
            if ok:
                success += 1
            else:
                failed += 1
        except Exception as e:
            print(f"\n错误: 合并 {ep_path.name} 失败: {e}", file=sys.stderr)
            failed += 1

    if len(args.ep_dirs) > 1:
        print(f"\n{'='*60}")
        print(f"全部完成: {success} 成功, {failed} 失败 / 共 {len(args.ep_dirs)} 集")


if __name__ == "__main__":
    main()
