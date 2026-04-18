"""
Phase 0：环境检查 — 检查所有依赖是否就绪，缺失时给出安装指令
用法：python phase0_check.py [--fix]
  --fix  尝试自动安装缺失的 Python 包（不含系统级依赖）
"""

import shutil
import subprocess
import sys
import importlib
from pathlib import Path


RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def check_command(name: str) -> bool:
    return shutil.which(name) is not None


def check_python_pkg(pkg: str) -> bool:
    try:
        importlib.import_module(pkg)
        return True
    except ImportError:
        return False


def check_ffmpeg_filter(filter_name: str) -> bool:
    """检查 ffmpeg 是否编译了指定滤镜"""
    if not check_command("ffmpeg"):
        return False
    result = subprocess.run(
        ["ffmpeg", "-filters"],
        capture_output=True, text=True, errors="ignore",
    )
    return filter_name in result.stdout


def check_env_var(name: str) -> bool:
    import os
    # 也检查 .env 和 default.env
    val = os.getenv(name)
    if val:
        return True
    # 尝试加载 dotenv
    try:
        from dotenv import dotenv_values
        script_dir = Path(__file__).parent
        skill_dir = script_dir.parent
        default_env = skill_dir / "assets" / "default.env"
        cwd_env = Path.cwd() / ".env"

        for env_file in [cwd_env, default_env]:
            if env_file.exists():
                vals = dotenv_values(env_file)
                if vals.get(name):
                    return True
    except ImportError:
        pass
    return False


def check_cjk_font() -> bool:
    """检查系统是否有中文字体"""
    if not check_command("fc-list"):
        # macOS 没有 fc-list 但自带中文字体
        import platform
        if platform.system() == "Darwin":
            return True
        return False
    result = subprocess.run(
        ["fc-list", ":lang=zh"],
        capture_output=True, text=True, errors="ignore",
    )
    return len(result.stdout.strip()) > 0


def pip_install(pkg: str) -> bool:
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", pkg],
        capture_output=True, text=True,
    )
    return result.returncode == 0


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Phase 0: 环境依赖检查")
    parser.add_argument("--fix", action="store_true", help="尝试自动安装缺失的 Python 包")
    args = parser.parse_args()

    print("=" * 50)
    print("Subtitle Maker 环境检查")
    print("=" * 50)

    all_ok = True
    fixes_needed = []

    # 1. Python 版本
    v = sys.version_info
    ok = v >= (3, 10)
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] Python 3.10+ (当前 {v.major}.{v.minor}.{v.micro})")
    if not ok:
        all_ok = False
        fixes_needed.append("需要 Python 3.10+")

    # 2. ffmpeg
    ok = check_command("ffmpeg")
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] ffmpeg")
    if not ok:
        all_ok = False
        fixes_needed.append("安装 ffmpeg: brew install homebrew-ffmpeg/ffmpeg/ffmpeg")

    # 3. ffmpeg subtitles 滤镜（libass）— 关键检查
    if check_command("ffmpeg"):
        ok = check_ffmpeg_filter("subtitles")
        status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"  [{status}] ffmpeg subtitles 滤镜 (libass)")
        if not ok:
            all_ok = False
            fixes_needed.append(
                "ffmpeg 缺少 subtitles 滤镜（需要 libass）。\n"
                "    修复方法（macOS）：\n"
                "      brew uninstall ffmpeg\n"
                "      brew tap homebrew-ffmpeg/ffmpeg\n"
                "      brew install homebrew-ffmpeg/ffmpeg/ffmpeg\n"
                "    修复方法（Linux）：\n"
                "      apt install ffmpeg  # 默认含 libass"
            )
    else:
        print(f"  [{YELLOW}SKIP{RESET}] ffmpeg subtitles 滤镜 (ffmpeg 未安装)")

    # 4. ffprobe
    ok = check_command("ffprobe")
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] ffprobe")
    if not ok:
        all_ok = False
        fixes_needed.append("ffprobe 随 ffmpeg 一起安装")

    # 5. Python 包: google-genai
    ok = check_python_pkg("google.genai")
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] google-genai")
    if not ok:
        if args.fix:
            print(f"    正在安装 google-genai...")
            if pip_install("google-genai"):
                print(f"    {GREEN}已安装{RESET}")
            else:
                all_ok = False
                fixes_needed.append("pip install google-genai")
        else:
            all_ok = False
            fixes_needed.append("pip install google-genai")

    # 6. Python 包: python-dotenv
    ok = check_python_pkg("dotenv")
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] python-dotenv")
    if not ok:
        if args.fix:
            print(f"    正在安装 python-dotenv...")
            if pip_install("python-dotenv"):
                print(f"    {GREEN}已安装{RESET}")
            else:
                all_ok = False
                fixes_needed.append("pip install python-dotenv")
        else:
            all_ok = False
            fixes_needed.append("pip install python-dotenv")

    # 7. GEMINI_API_KEY
    ok = check_env_var("GEMINI_API_KEY")
    status = f"{GREEN}OK{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  [{status}] GEMINI_API_KEY")
    if not ok:
        all_ok = False
        fixes_needed.append("设置 GEMINI_API_KEY: export GEMINI_API_KEY=xxx")

    # 8. 中文字体
    ok = check_cjk_font()
    status = f"{GREEN}OK{RESET}" if ok else f"{YELLOW}WARN{RESET}"
    print(f"  [{status}] 中文字体 (CJK)")
    if not ok:
        fixes_needed.append(
            "安装中文字体: apt install fonts-noto-cjk (Linux)\n"
            "    macOS 通常自带中文字体"
        )

    # 汇总
    print()
    if all_ok:
        print(f"{GREEN}所有依赖检查通过！可以开始使用 subtitle-maker。{RESET}")
    else:
        print(f"{RED}发现以下问题需要修复：{RESET}")
        for i, fix in enumerate(fixes_needed, 1):
            print(f"  {i}. {fix}")
        print()
        if not args.fix:
            print(f"提示：运行 python3 phase0_check.py --fix 可自动安装 Python 包")
        sys.exit(1)


if __name__ == "__main__":
    main()
