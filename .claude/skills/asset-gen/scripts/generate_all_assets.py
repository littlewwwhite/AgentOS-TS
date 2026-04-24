#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一资产生成编排器 - 并行生成角色、场景、道具

前置条件:
  1. style.json 已生成（通过 style_generate.py）
  2. 提示词 JSON 已生成（通过 generate_prompts_from_script.py）
     - {title}_actors_gen.json
     - {title}_scenes_gen.json
     - {title}_props_gen.json

流程:
  并行生成三类资产 (generate_*.py × 3) → 汇总执行结果

用法:
  python generate_all_assets.py \\
    --script-json "path/to/script.json" \\
    --project-dir "path/to/output" \\
    --workspace   "path/to/workspace"
"""
import sys, os, json, time, argparse, subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from pipeline_state import ensure_state, update_artifact, update_stage

# UTF-8 输出
if sys.platform == 'win32':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    elif hasattr(sys.stdout, 'buffer'):
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ── 外部脚本路径 ──────────────────────────────────────────────────────────────
CURRENT_SKILL = Path(__file__).parent

CHAR_GEN_SCRIPT  = CURRENT_SKILL / "generate_characters.py"
SCENE_GEN_SCRIPT = CURRENT_SKILL / "generate_scenes.py"
PROPS_GEN_SCRIPT = CURRENT_SKILL / "generate_props.py"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run_subprocess(label, script_path, args, timeout=7200):
    """运行子进程脚本"""
    log(f"\n[{label}] 启动: {script_path.name}")
    try:
        env = {**os.environ, "PYTHONUTF8": "1"}
        result = subprocess.run(
            [sys.executable, str(script_path)] + args,
            env=env, capture_output=True, text=True, timeout=timeout
        )
        if result.returncode == 0:
            log(f"✓ [{label}] 完成")
            return {"success": True, "label": label, "stdout": result.stdout}
        else:
            log(f"❌ [{label}] 失败 (返回码: {result.returncode})")
            log(f"  stderr: {result.stderr[-300:]}")
            return {"success": False, "label": label, "error": result.stderr}
    except subprocess.TimeoutExpired:
        log(f"❌ [{label}] 超时（{timeout}秒）")
        return {"success": False, "label": label, "error": "Timeout"}
    except Exception as e:
        log(f"❌ [{label}] 异常: {e}")
        return {"success": False, "label": label, "error": str(e)}


def generate_all_assets(script_json, project_dir, workspace,
                       characters=False, scenes=False, props=False, voice=False,
                       debug=False, regenerate_actors=None, regenerate_scenes=None, regenerate_props=None,
                       skip_subject=True, skip_head=True):
    """主编排函数 - 并行生成角色、场景、道具（按项目生成所有资产）"""
    log(f"=== 开始生成项目所有资产 ===")
    log(f"项目目录: {project_dir}")
    log(f"工作区: {workspace}")

    project_root = Path(project_dir).resolve().parent
    ensure_state(str(project_root))
    update_stage(str(project_root), "VISUAL", "running", next_action="review VISUAL")

    workspace_path = Path(workspace)
    workspace_path.mkdir(parents=True, exist_ok=True)

    # ================================================================
    # 检查前置条件：提示词 JSON 文件必须存在
    # ================================================================
    log("\n=== 检查前置条件 ===")

    # 从 script.json 读取项目标题
    project_title = "未命名项目"
    if script_json and Path(script_json).exists():
        try:
            with open(script_json, 'r', encoding='utf-8') as f:
                script_data = json.load(f)
                project_title = script_data.get('title', project_title).replace(' ', '')
        except Exception as e:
            log(f"⚠ 读取 script.json 失败: {e}")

    # 仅检查实际需要的提示词 JSON 文件
    chars_json  = workspace_path / f"{project_title}_actors_gen.json"
    scenes_json = workspace_path / f"{project_title}_scenes_gen.json"
    props_json  = workspace_path / f"{project_title}_props_gen.json"

    missing_files = []
    if (characters or voice) and not chars_json.exists():
        missing_files.append(str(chars_json))
    if scenes and not scenes_json.exists():
        missing_files.append(str(scenes_json))
    if props and not props_json.exists():
        missing_files.append(str(props_json))

    if missing_files:
        log("❌ 缺少必需的提示词 JSON 文件:")
        for f in missing_files:
            log(f"  - {f}")
        log("\n请先执行以下步骤:")
        log("  1. style_generate.py - 生成 style.json")
        log("  2. generate_prompts_from_script.py - 生成提示词 JSON")
        return

    log(f"✓ 提示词 JSON 文件已就绪")

    # 检查 style.json
    style_json = workspace_path / "style.json"
    if not style_json.exists():
        log("⚠ style.json 不存在,将使用通用审图标准")
    else:
        log(f"✓ style.json 已就绪")

    # ================================================================
    # 并行生成三类资产
    # ================================================================
    log("\n=== 并行生成资产 ===")

    tasks = []

    # ── 角色生成任务 ──────────────────────────────────────────────────
    if characters or voice:
        char_args = [
            "--actors-json", str(chars_json),
            "--project-dir", project_dir,
            "--workspace", workspace,
        ]
        if characters:
            char_args.append("--characters")
        if voice:
            char_args.append("--voice")
        if debug:
            char_args.append("--debug")
        if regenerate_actors:
            char_args += ["--regenerate", regenerate_actors]
        if skip_subject:
            char_args.append("--skip-subject")
        if skip_head:
            char_args.append("--skip-head")
        tasks.append(("角色生成", CHAR_GEN_SCRIPT, char_args))

    # ── 场景生成任务 ──────────────────────────────────────────────────
    if scenes:
        scene_args = [
            "--scenes-json", str(scenes_json),
            "--project-dir", project_dir,
            "--workspace", workspace,
        ]
        if debug:
            scene_args.append("--debug")
        if regenerate_scenes:
            scene_args += ["--regenerate", regenerate_scenes]
        if skip_subject:
            scene_args.append("--skip-subject")
        tasks.append(("场景生成", SCENE_GEN_SCRIPT, scene_args))

    # ── 道具生成任务 ──────────────────────────────────────────────────
    if props:
        props_args = [
            "--props-json", str(props_json),
            "--project-dir", project_dir,
            "--workspace", workspace,
        ]
        if debug:
            props_args.append("--debug")
        if regenerate_props:
            props_args += ["--regenerate", regenerate_props]
        if skip_subject:
            props_args.append("--skip-subject")
        tasks.append(("道具生成", PROPS_GEN_SCRIPT, props_args))

    # ── 并行执行所有生成任务 ──────────────────────────────────────────
    log(f"\n并行启动 {len(tasks)} 个生成管线...")
    results = []

    if not tasks:
        log("未指定任何生成类型，无需执行。")
    else:
        with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
            futures = {
                executor.submit(run_subprocess, label, script, args): label
                for label, script, args in tasks
            }

            for future in as_completed(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    label = futures[future]
                    log(f"❌ [{label}] 执行异常: {e}")
                    results.append({"success": False, "label": label, "error": str(e)})

    # ================================================================
    # 汇总结果
    # ================================================================
    log("\n=== 执行结果汇总 ===")
    success_count = sum(1 for r in results if r.get('success'))
    total_count = len(results)

    for r in results:
        status = "✓ 成功" if r.get('success') else "✗ 失败"
        log(f"  [{r['label']}] {status}")
        if not r.get('success') and r.get('error'):
            log(f"    错误: {r['error'][:150]}")

    log(f"\n=== 项目资产生成完成 ===")
    log(f"  成功: {success_count}/{total_count}")
    log(f"  输出目录: {project_dir}")

    if success_count == total_count and total_count > 0:
        log("✓ 所有资产生成成功!")
    elif success_count > 0:
        log("⚠ 部分资产生成成功,请检查失败项")
    else:
        log("❌ 所有资产生成失败")

    artifact_specs = []
    if characters or voice:
        artifact_specs.append(("output/actors/actors.json", Path(project_dir).resolve() / "actors" / "actors.json"))
    if scenes:
        artifact_specs.append(("output/locations/locations.json", Path(project_dir).resolve() / "locations" / "locations.json"))
    if props:
        artifact_specs.append(("output/props/props.json", Path(project_dir).resolve() / "props" / "props.json"))

    completed_artifacts = []
    for rel_path, abs_path in artifact_specs:
        if abs_path.exists():
            completed_artifacts.append(rel_path)
            update_artifact(str(project_root), rel_path, "canonical", "visual", "completed")

    if completed_artifacts and success_count == total_count and total_count > 0:
        update_stage(
            str(project_root),
            "VISUAL",
            "completed",
            next_action="review VISUAL",
            artifact=completed_artifacts[0],
        )
    elif completed_artifacts:
        update_stage(
            str(project_root),
            "VISUAL",
            "partial",
            next_action="review VISUAL",
            artifact=completed_artifacts[0],
        )
    else:
        update_stage(
            str(project_root),
            "VISUAL",
            "failed",
            next_action="retry VISUAL",
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="统一资产生成编排器 - 并行生成角色/场景/道具")
    parser.add_argument("--script-json", required=True, help="script.json 路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录")
    parser.add_argument("--workspace",   required=True, help="工作区目录")
    parser.add_argument("--characters",  action="store_true", help="生成角色（含三视图）")
    parser.add_argument("--scenes",      action="store_true", help="生成场景")
    parser.add_argument("--props",       action="store_true", help="生成道具")
    parser.add_argument("--voice",       action="store_true", help="生成角色音色")
    parser.add_argument("--debug",       action="store_true", help="调试模式，保留 _temp 临时文件")
    parser.add_argument("--regenerate-actors", default=None, help="指定重新生成的角色名称，逗号分隔")
    parser.add_argument("--regenerate-scenes", default=None, help="指定重新生成的场景名称，逗号分隔")
    parser.add_argument("--regenerate-props",  default=None, help="指定重新生成的道具名称，逗号分隔")
    parser.add_argument("--skip-subject", action="store_true", default=True, help="跳过创建主体（默认跳过）")
    parser.add_argument("--skip-head", action="store_true", default=True, help="跳过头部特写生成（默认跳过）")

    args = parser.parse_args()

    generate_all_assets(
        args.script_json,
        args.project_dir,
        args.workspace,
        args.characters,
        args.scenes,
        args.props,
        args.voice,
        args.debug,
        args.regenerate_actors,
        args.regenerate_scenes,
        args.regenerate_props,
        args.skip_subject,
        args.skip_head,
    )
