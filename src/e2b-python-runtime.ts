export const PYTHON_RUNTIME_VERSION = "3.12";
export const PYTHON_RUNTIME_HOME = "/home/user/.agentos/python";
export const PYTHON_RUNTIME_VENV_DIR = `${PYTHON_RUNTIME_HOME}/venv`;
export const PYTHON_RUNTIME_PROJECT_DIR = "/home/user/app/e2b/python-runtime";
export const PYTHON_RUNTIME_PACKAGE_FILE = "/home/user/app/e2b/python-runtime/pyproject.toml";
export const PYTHON_RUNTIME_INPUT_DIRS = ["e2b/python-runtime"];

export function getPythonRuntimeBuildCommands(): string[] {
  return [
    "curl -LsSf https://astral.sh/uv/install.sh | sh",
    [
      'export PATH="/root/.local/bin:$PATH"',
      `uv python install ${PYTHON_RUNTIME_VERSION}`,
      `uv venv ${PYTHON_RUNTIME_VENV_DIR} --python ${PYTHON_RUNTIME_VERSION}`,
      `VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR} PATH="${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH" uv sync --active --project ${PYTHON_RUNTIME_PROJECT_DIR} --locked`,
      `echo 'export VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR}' >> /home/user/.bashrc`,
      `echo 'export PATH=\"${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH\"' >> /home/user/.bashrc`,
      `echo 'export VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR}' >> /home/user/.profile`,
      `echo 'export PATH=\"${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH\"' >> /home/user/.profile`,
      `echo 'export VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR}' >> /home/user/.zshrc`,
      `echo 'export PATH=\"${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH\"' >> /home/user/.zshrc`,
      `test -x ${PYTHON_RUNTIME_VENV_DIR}/bin/python3`,
      `VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR} PATH="${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH" python3 --version`,
      `VIRTUAL_ENV=${PYTHON_RUNTIME_VENV_DIR} PATH="${PYTHON_RUNTIME_VENV_DIR}/bin:$PATH" python3 -c "from google import genai; import pydantic; import requests; import qcloud_cos"`,
    ].join(" && "),
  ];
}
