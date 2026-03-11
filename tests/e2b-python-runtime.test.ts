import { describe, expect, it } from "vitest";
import {
  PYTHON_RUNTIME_INPUT_DIRS,
  PYTHON_RUNTIME_PACKAGE_FILE,
  PYTHON_RUNTIME_PROJECT_DIR,
  PYTHON_RUNTIME_VENV_DIR,
  getPythonRuntimeBuildCommands,
} from "../src/e2b-python-runtime.js";

describe("e2b python runtime", () => {
  it("installs Python into a user-writable virtual environment with locked deps", () => {
    const commands = getPythonRuntimeBuildCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("uv/install.sh");
    expect(commands[1]).toContain(`uv venv ${PYTHON_RUNTIME_VENV_DIR} --python 3.12`);
    expect(commands[1]).toContain(
      `uv sync --active --project ${PYTHON_RUNTIME_PROJECT_DIR} --locked`,
    );
    expect(commands[1]).toContain(`VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR}`);
    expect(commands[1]).toContain(`PATH="${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH"`);
    expect(PYTHON_RUNTIME_PACKAGE_FILE).toBe(`${PYTHON_RUNTIME_PROJECT_DIR}/pyproject.toml`);
  });

  it("does not rely on root-owned install locations or global python symlinks", () => {
    const command = getPythonRuntimeBuildCommands()[1];

    expect(command).not.toContain("/opt/");
    expect(command).not.toContain("/usr/local/bin/python3");
    expect(command).not.toContain("ln -sf");
    expect(command).not.toContain("--system");
  });

  it("treats python dependency definitions as template inputs", () => {
    expect(PYTHON_RUNTIME_INPUT_DIRS).toContain("e2b/python-runtime");
  });
});
