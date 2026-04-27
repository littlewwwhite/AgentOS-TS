# input: CLI argv for AgentOS infrastructure commands
# output: process exit code and command output
# pos: top-level command entrypoint for the aos-cli executable

import argparse
from collections.abc import Sequence
import json
from pathlib import Path
import sys

from aos_cli.env import load_project_env
from aos_cli.model.batch import batch_failure_report, parse_batch_manifest, run_batch
from aos_cli.model.capabilities import capabilities_payload
from aos_cli.model.errors import ModelServiceError
from aos_cli.model.preflight import preflight_payload
from aos_cli.model.protocol import failure_response, validate_request_payload
from aos_cli.model.service import build_default_model_service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aos-cli")
    parser.add_argument(
        "--env-file",
        type=Path,
        default=None,
        help="Path to a .env file to load before running the command.",
    )
    namespaces = parser.add_subparsers(dest="namespace", required=True)

    model = namespaces.add_parser("model")
    model_commands = model.add_subparsers(dest="model_command", required=True)

    run = model_commands.add_parser("run")
    run.add_argument("--input", required=True)
    run.add_argument("--output", required=True)

    submit = model_commands.add_parser("submit")
    submit.add_argument("--input", required=True)
    submit.add_argument("--output", required=True)

    poll = model_commands.add_parser("poll")
    poll.add_argument("--input", required=True)
    poll.add_argument("--output", required=True)

    preflight = model_commands.add_parser("preflight")
    preflight.add_argument("--json", action="store_true", dest="json_output")

    capabilities = model_commands.add_parser("capabilities")
    capabilities.add_argument("--json", action="store_true", dest="json_output")

    validate = model_commands.add_parser("validate")
    validate.add_argument("--input", required=True)

    batch = model_commands.add_parser("batch")
    batch.add_argument("--manifest", required=True)
    batch.add_argument("--report", required=True)

    return parser


def _read_input_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def _write_output_text(path: str, payload: str) -> None:
    if not payload.endswith("\n"):
        payload = payload + "\n"
    if path == "-":
        sys.stdout.write(payload)
        sys.stdout.flush()
        return
    Path(path).write_text(payload, encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code)
    load_project_env(args.env_file)
    return run_model_command(args)


def _single_request_failure(args: argparse.Namespace, message: str) -> dict:
    return failure_response(
        task="unknown",
        capability=args.model_command,
        code="INVALID_REQUEST",
        message=message,
        retryable=False,
    )


def _write_response(path: str, response: dict) -> int:
    try:
        _write_output_text(path, json.dumps(response, ensure_ascii=False, indent=2))
    except OSError as exc:
        fallback = failure_response(
            task=response.get("task", "unknown"),
            capability=response.get("capability", "unknown"),
            code="INVALID_REQUEST",
            message=str(exc),
            retryable=False,
        )
        sys.stderr.write(json.dumps(fallback, ensure_ascii=False, indent=2) + "\n")
        return 2
    return 0 if response.get("ok") else 2


def _run_single_request_command(args: argparse.Namespace, handler) -> int:
    try:
        request = json.loads(_read_input_text(args.input))
    except OSError as exc:
        return _write_response(args.output, _single_request_failure(args, str(exc)))
    except json.JSONDecodeError as exc:
        return _write_response(
            args.output,
            _single_request_failure(args, f"Input file is not valid JSON: {exc.msg}"),
        )
    return _write_response(args.output, handler(request))


def run_model_command(args: argparse.Namespace) -> int:
    if args.namespace != "model":
        raise SystemExit(f"Unsupported namespace: {args.namespace}")
    if args.model_command == "run":
        return _run_single_request_command(args, build_default_model_service().run)
    if args.model_command == "submit":
        return _run_single_request_command(args, build_default_model_service().submit)
    if args.model_command == "poll":
        return _run_single_request_command(args, build_default_model_service().poll)
    if args.model_command == "preflight":
        response = preflight_payload()
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0 if response.get("ok") else 2
    if args.model_command == "capabilities":
        response = capabilities_payload()
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0
    if args.model_command == "validate":
        try:
            payload = json.loads(_read_input_text(args.input))
        except OSError as exc:
            response = _single_request_failure(args, str(exc))
        except json.JSONDecodeError as exc:
            response = _single_request_failure(
                args,
                f"Input file is not valid JSON: {exc.msg}",
            )
        else:
            response = validate_request_payload(payload)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0 if response.get("ok") else 2
    if args.model_command == "batch":
        try:
            manifest = json.loads(_read_input_text(args.manifest))
            response = run_batch(parse_batch_manifest(manifest), build_default_model_service)
        except OSError as exc:
            response = batch_failure_report(ModelServiceError("INVALID_REQUEST", str(exc)))
        except json.JSONDecodeError as exc:
            response = batch_failure_report(
                ModelServiceError(
                    "INVALID_REQUEST",
                    f"Batch manifest file is not valid JSON: {exc.msg}",
                )
            )
        except ModelServiceError as exc:
            response = batch_failure_report(exc)
        report_text = json.dumps(response, ensure_ascii=False, indent=2)
        try:
            _write_output_text(args.report, report_text)
        except OSError as exc:
            fallback_text = json.dumps(
                batch_failure_report(ModelServiceError("INVALID_REQUEST", str(exc))),
                ensure_ascii=False,
                indent=2,
            )
            sys.stderr.write(fallback_text + "\n")
            return 2
        return 0 if response.get("ok") else 2
    raise SystemExit(f"Unsupported model command: {args.model_command}")


if __name__ == "__main__":
    raise SystemExit(main())
