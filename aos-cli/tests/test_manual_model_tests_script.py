import json
import os
import pty
import shutil
import subprocess
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_DIR.parent
SCRIPT_PATH = PACKAGE_DIR / "scripts" / "manual-model-tests.sh"
DEFAULT_TEXT_PROMPT = "为月光庭院场景写一句简短的制作说明。"
DIRECT_ANSWER_SYSTEM_PROMPT = "Answer the user request directly and concisely."


def test_manual_model_menu_uses_chinese_user_visible_text(tmp_path):
    env = real_text_test_env(tmp_path)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=env,
        input="0\n",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "aos-cli 模型手动测试" in result.stdout
    assert "工作目录:" in result.stdout
    assert "能力列表" in result.stdout
    assert "预检环境" in result.stdout
    assert "真实文本生成" in result.stdout
    assert "真实 JSON 生成" in result.stdout
    assert "真实图片生成，仅返回远程产物 (OpenAI 兼容)" in result.stdout
    assert "真实图片生成，下载产物 (OpenAI 兼容)" in result.stdout
    assert "真实视频提交" in result.stdout
    assert "真实视频轮询" in result.stdout
    assert "负向校验测试" in result.stdout
    assert "退出" in result.stdout
    assert "请选择测试:" in result.stdout


def test_manual_model_menu_does_not_include_fake_entries(tmp_path):
    env = real_text_test_env(tmp_path)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=env,
        input="0\n",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "fake text generation" not in result.stdout
    assert "fake image generation" not in result.stdout
    assert "fake video submit + poll" not in result.stdout


def test_manual_model_test_accepts_prompt_argument(tmp_path):
    prompt = "A fox crossing a rain-soaked cyberpunk street."
    request, _stdout = run_real_text_test(tmp_path, prompt)

    assert request["input"]["content"] == prompt


def test_manual_model_test_escapes_prompt_argument_as_json(tmp_path):
    prompt = 'A "fox" crossing rain.\nCamera: low angle.'
    request, _stdout = run_real_text_test(tmp_path, prompt)

    assert request["input"]["content"] == prompt


def test_real_text_generation_uses_direct_answer_system_prompt(tmp_path):
    request, _stdout = run_real_text_test(tmp_path, "Generate today's date.")

    assert request["input"]["system"] == DIRECT_ANSWER_SYSTEM_PROMPT


def test_real_text_generation_does_not_limit_output_tokens(tmp_path):
    request, _stdout = run_real_text_test(tmp_path, "Write a detailed answer.")

    assert "maxOutputTokens" not in request["options"]


def test_real_json_generation_does_not_limit_output_tokens(tmp_path):
    request, _stdout = run_real_json_test(tmp_path, "Return a detailed JSON object.")

    assert "maxOutputTokens" not in request["options"]


def test_real_text_generation_prints_text_output_readably(tmp_path):
    _request, stdout = run_real_text_test(tmp_path, "Say hello.")

    assert stdout.index("\"output\"") < stdout.index("文本输出:\nfake response")


def test_negative_validation_prints_chinese_error_summaries(tmp_path):
    env = real_text_test_env(tmp_path)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "9"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "校验结果: 缺少必填字段 apiVersion" in result.stdout
    assert "校验结果: 不支持的输出类型 artifact" in result.stdout
    assert "校验结果: 不支持的能力 storyboard.render" in result.stdout
    assert "Missing required field" not in result.stdout
    assert result.stdout.count("退出码:") == 3
    assert "Unsupported output kind" not in result.stdout
    assert "Unsupported capability" not in result.stdout


def test_negative_validation_fails_when_invalid_request_is_accepted(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_uv.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    fake_uv.chmod(0o755)
    env = real_text_test_env(tmp_path)
    env["PATH"] = f"{bin_dir}:/bin:/usr/bin"

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "9"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert "校验结果: 未发现预期错误" in result.stdout


def test_print_file_uses_python3_when_jq_and_python_are_unavailable(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    python3 = shutil.which("python3")
    uv = shutil.which("uv")
    bash = shutil.which("bash")
    assert python3 is not None
    assert uv is not None
    assert bash is not None
    (bin_dir / "python3").symlink_to(python3)
    (bin_dir / "uv").symlink_to(uv)
    env = real_text_test_env(tmp_path)
    env["PATH"] = f"{bin_dir}:/bin:/usr/bin"

    result = subprocess.run(
        [bash, str(SCRIPT_PATH), "3", "Say hello."],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "文本输出:\nfake response" in result.stdout


def test_real_image_download_escapes_artifact_policy_local_dir_as_json(tmp_path):
    work_dir = tmp_path / 'quoted"dir'
    env = real_text_test_env(work_dir)
    env["OPENAI_API_KEY"] = "test-key"

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "6", "Draw a fox."],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    request = json.loads((work_dir / "image.real.download.request.json").read_text(encoding="utf-8"))
    assert request["artifactPolicy"]["localDir"] == str(work_dir / "artifacts" / "image-real")


def test_interactive_manual_model_test_prompts_without_default_and_returns_to_menu(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_TEST_DIR", str(tmp_path))
    monkeypatch.setenv("AOS_CLI_ENV_FILE", str(tmp_path / ".env"))
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    output = bytearray()

    def capture(fd):
        chunk = os.read(fd, 1024)
        output.extend(chunk)
        return chunk

    prompt = "生成今天的日期。"
    process = pty.spawn(
        ["bash", str(SCRIPT_PATH)],
        capture,
        make_interactive_input(["3\n", f"{prompt}\n", "0\n"]),
    )

    assert process == 0
    stdout = output.decode("utf-8", errors="ignore")
    assert "提示词:" in stdout
    assert "提示词 [" not in stdout
    assert "按 Enter 继续" not in stdout
    assert stdout.count("请选择测试:") == 2
    request = json.loads((tmp_path / "text.real.request.json").read_text(encoding="utf-8"))
    assert request["input"]["content"] == prompt


def test_manual_model_test_does_not_execute_env_file_shell_code(tmp_path):
    marker = tmp_path / "env-executed"
    env_file = tmp_path / ".env"
    env_file.write_text(f"GEMINI_API_KEY=$(touch {marker})\n", encoding="utf-8")
    env = os.environ.copy()
    env["AOS_CLI_TEST_DIR"] = str(tmp_path)
    env["AOS_CLI_ENV_FILE"] = str(env_file)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "1"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def run_real_text_test(tmp_path, prompt):
    env = real_text_test_env(tmp_path)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "3", prompt],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    return json.loads((tmp_path / "text.real.request.json").read_text(encoding="utf-8")), result.stdout


def run_real_json_test(tmp_path, prompt):
    env = real_text_test_env(tmp_path)

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH), "4", prompt],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    return json.loads((tmp_path / "text.json.request.json").read_text(encoding="utf-8")), result.stdout


def real_text_test_env(tmp_path):
    env = os.environ.copy()
    env["AOS_CLI_TEST_DIR"] = str(tmp_path)
    env["AOS_CLI_ENV_FILE"] = str(tmp_path / ".env")
    env["AOS_CLI_MODEL_FAKE"] = "1"
    env["GEMINI_API_KEY"] = "test-key"
    return env


def make_interactive_input(inputs):
    remaining = bytearray("".join(inputs), "utf-8")

    def read(_fd):
        if not remaining:
            return b""
        chunk = bytes(remaining[:1])
        del remaining[:1]
        return chunk

    return read
