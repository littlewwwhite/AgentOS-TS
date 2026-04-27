from pathlib import Path

from aos_cli.cli import main


def test_pyproject_declares_aos_cli_entrypoint():
    pyproject_path = Path(__file__).resolve().parents[1] / "pyproject.toml"
    pyproject = pyproject_path.read_text(encoding="utf-8")

    assert 'aos-cli = "aos_cli.cli:main"' in pyproject
    assert 'aos = "aos_cli.cli:main"' not in pyproject


def test_main_help_returns_zero(capsys):
    code = main(["--help"])

    assert code == 0
    captured = capsys.readouterr()
    assert "aos-cli" in captured.out
