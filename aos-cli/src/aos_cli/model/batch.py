# input: batch manifest payloads
# output: validated batch manifests and batch reports
# pos: bounded local batch orchestration for model requests

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
from typing import Callable

from aos_cli.model.errors import ModelServiceError

BATCH_API_VERSION = "aos-cli.model.batch/v1"
ServiceFactory = Callable[[], object]


def parse_batch_manifest(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError("INVALID_REQUEST", "Batch manifest must be an object")
    if payload.get("apiVersion") != BATCH_API_VERSION:
        raise ModelServiceError("INVALID_REQUEST", "Unsupported batch apiVersion")
    jobs = payload.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        raise ModelServiceError("INVALID_REQUEST", "jobs must be a non-empty list")
    concurrency = _parse_concurrency(payload.get("concurrency", 1))
    for job in jobs:
        if not isinstance(job, dict):
            raise ModelServiceError("INVALID_REQUEST", "each job must be an object")
        for field in ("id", "request", "output"):
            if not job.get(field):
                raise ModelServiceError("INVALID_REQUEST", f"job.{field} is required")
    return {"apiVersion": BATCH_API_VERSION, "concurrency": concurrency, "jobs": jobs}


def batch_validation_report(manifest: dict) -> dict:
    return {
        "ok": True,
        "valid": True,
        "apiVersion": BATCH_API_VERSION,
        "concurrency": manifest["concurrency"],
        "jobCount": len(manifest["jobs"]),
        "warnings": [],
    }


def run_batch(manifest: dict, service_factory: ServiceFactory) -> dict:
    jobs = manifest["jobs"]
    concurrency = manifest["concurrency"]
    results = []

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(_run_job, index, job, service_factory): job for index, job in enumerate(jobs)}
        for future in as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda item: item["index"])
    job_reports = [{key: value for key, value in item.items() if key != "index"} for item in results]
    succeeded = sum(1 for item in job_reports if item["ok"])
    failed = len(job_reports) - succeeded
    retryable_failed = sum(1 for item in job_reports if not item["ok"] and item.get("retryable"))
    return {
        "ok": failed == 0,
        "valid": True,
        "apiVersion": BATCH_API_VERSION,
        "total": len(job_reports),
        "succeeded": succeeded,
        "failed": failed,
        "retryableFailed": retryable_failed,
        "jobs": job_reports,
        "warnings": [],
    }


def batch_failure_report(error: ModelServiceError) -> dict:
    return {
        "ok": False,
        "valid": False,
        "apiVersion": BATCH_API_VERSION,
        "error": {
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
        },
        "warnings": [],
    }


def _run_job(index: int, job: dict, service_factory: ServiceFactory) -> dict:
    try:
        request_path = Path(job["request"])
        output_path = Path(job["output"])
        request = json.loads(request_path.read_text(encoding="utf-8"))
        response = service_factory().run(request)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
        error = response.get("error", {})
        return {
            "index": index,
            "id": job["id"],
            "ok": bool(response.get("ok")),
            "request": str(request_path),
            "output": str(output_path),
            "retryable": bool(error.get("retryable", False)),
            "error": error or None,
        }
    except (OSError, json.JSONDecodeError, ModelServiceError) as exc:
        return {
            "index": index,
            "id": job.get("id", "unknown"),
            "ok": False,
            "request": job.get("request", ""),
            "output": job.get("output", ""),
            "retryable": False,
            "error": {
                "code": "BATCH_JOB_FAILED",
                "message": str(exc),
                "retryable": False,
            },
        }


def _parse_concurrency(value: object) -> int:
    try:
        concurrency = int(value)
    except (TypeError, ValueError) as exc:
        raise ModelServiceError("INVALID_REQUEST", "concurrency must be an integer") from exc
    if concurrency < 1:
        raise ModelServiceError("INVALID_REQUEST", "concurrency must be >= 1")
    return concurrency
