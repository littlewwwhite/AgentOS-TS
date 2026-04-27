import os

from aos_cli.env import load_project_env, parse_env_line


def test_load_project_env_loads_cwd_dot_env_only(tmp_path, monkeypatch):
    project = tmp_path / "project"
    nested = project / "aos-cli"
    nested.mkdir(parents=True)
    (project / ".env").write_text("PARENT_ONLY=parent\n", encoding="utf-8")
    (nested / ".env").write_text("CHILD_ONLY=child\n", encoding="utf-8")

    monkeypatch.chdir(nested)
    monkeypatch.delenv("PARENT_ONLY", raising=False)
    monkeypatch.delenv("CHILD_ONLY", raising=False)

    loaded = load_project_env()

    assert loaded == nested / ".env"
    assert os.environ["CHILD_ONLY"] == "child"
    assert "PARENT_ONLY" not in os.environ


def test_load_project_env_returns_none_when_no_dot_env(tmp_path, monkeypatch):
    nested = tmp_path / "nowhere"
    nested.mkdir()
    monkeypatch.chdir(nested)

    assert load_project_env() is None


def test_load_project_env_uses_explicit_path_when_given(tmp_path, monkeypatch):
    explicit = tmp_path / "custom.env"
    explicit.write_text("EXPLICIT=value\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("EXPLICIT", raising=False)

    assert load_project_env(explicit) == explicit
    assert os.environ["EXPLICIT"] == "value"


def test_load_project_env_explicit_path_wins_over_cwd(tmp_path, monkeypatch):
    explicit = tmp_path / "custom.env"
    explicit.write_text("KEY=from-explicit\n", encoding="utf-8")
    (tmp_path / ".env").write_text("KEY=from-cwd\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("KEY", raising=False)

    load_project_env(explicit)

    assert os.environ["KEY"] == "from-explicit"


def test_load_project_env_does_not_override_existing_environment(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("KEEP=from-file\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("KEEP", "from-shell")

    load_project_env()

    assert os.environ["KEEP"] == "from-shell"


def test_parse_env_line_supports_export_and_quoted_values():
    assert parse_env_line('export ARK_VIDEO_MODEL="ep-1"') == ("ARK_VIDEO_MODEL", "ep-1")
    assert parse_env_line("ARK_API_KEY='ark-key'") == ("ARK_API_KEY", "ark-key")
    assert parse_env_line("# comment") is None
