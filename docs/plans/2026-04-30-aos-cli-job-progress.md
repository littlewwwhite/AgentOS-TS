# AOS CLI Job Progress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make aos-cli long-running tasks visible to both the console UI and the Agent while they are queued, polling, downloading, reviewing, completed, or failed.

**Architecture:** Add a lightweight filesystem-backed job ledger under each project at `.agentos/jobs/`, with atomic JSON snapshots written by skill scripts. Keep `pipeline-state.json` as the stage-level index, and use the job ledger for task-level progress. The console reads the ledger through a small API and renders concise progress without inventing provider queue positions that aos-cli cannot verify.

**Tech Stack:** Python 3.11 skill scripts, aos-cli submit/poll envelopes, Bun/TypeScript console API, React UI, Vitest.

---

### Task 1: Define Job Ledger Contract

**Files:**
- Create: `docs/job-ledger-contract.md`
- Modify: `docs/pipeline-state-contract.md`

**Step 1: Write the contract doc**

Create `docs/job-ledger-contract.md` with this structure:

```markdown
# Job Ledger Contract

Project job ledgers live under `.agentos/jobs/<kind>/`.

`pipeline-state.json` answers stage-level questions. Job ledgers answer task-level questions for long-running provider work.

## Paths

- `.agentos/jobs/<kind>/latest.json`
- `.agentos/jobs/<kind>/<run_id>.json`

## Minimum Shape

```json
{
  "version": 1,
  "run_id": "video-20260430-183012",
  "kind": "video.generate",
  "stage": "VIDEO",
  "episode": "ep001",
  "status": "running",
  "started_at": "2026-04-30T10:30:12Z",
  "updated_at": "2026-04-30T10:32:18Z",
  "summary": {
    "total": 24,
    "submitted": 8,
    "polling": 8,
    "downloading": 0,
    "reviewing": 0,
    "completed": 3,
    "failed": 0
  },
  "items": [
    {
      "id": "scn001_clip001",
      "status": "polling",
      "task_id": "provider-task-id",
      "provider_status": "PENDING",
      "submitted_at": "2026-04-30T10:30:30Z",
      "last_poll_at": "2026-04-30T10:32:18Z",
      "elapsed_seconds": 108,
      "output_path": "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4",
      "message": "Waiting for video provider"
    }
  ]
}
```

## Status Values

- `pending`
- `submitting`
- `submitted`
- `polling`
- `downloading`
- `reviewing`
- `completed`
- `failed`
- `cancelled`

Provider queue rank must not be fabricated. If the provider only exposes a pending task result, record `provider_status` and elapsed time.
```

**Step 2: Link from pipeline state contract**

Add a short section to `docs/pipeline-state-contract.md` after Core Rules:

```markdown
## Long-Running Job Progress

`pipeline-state.json` is not a provider task queue. Long-running aos-cli tasks must write task-level progress to `.agentos/jobs/<kind>/latest.json` and keep stage-level status synchronized here.
```

**Step 3: Commit**

```bash
git add docs/job-ledger-contract.md docs/pipeline-state-contract.md
git commit -m "docs: define aos-cli job ledger contract"
```

---

### Task 2: Add Python Job Ledger Writer

**Files:**
- Create: `.claude/skills/_shared/job_ledger.py`
- Test: `.claude/skills/_shared/test_job_ledger.py`

**Step 1: Write failing tests**

Create `.claude/skills/_shared/test_job_ledger.py`:

```python
import json
from pathlib import Path

from job_ledger import JobLedger


def test_job_ledger_writes_run_and_latest(tmp_path: Path):
    ledger = JobLedger(tmp_path, kind="video.generate", run_id="video-test")

    ledger.start(stage="VIDEO", episode="ep001", total=2)
    ledger.update_item(
        "scn001_clip001",
        status="submitted",
        task_id="task-1",
        output_path="output/ep001/scn001/clip001/a.mp4",
        message="submitted",
    )

    run_path = tmp_path / ".agentos/jobs/video.generate/video-test.json"
    latest_path = tmp_path / ".agentos/jobs/video.generate/latest.json"

    assert run_path.exists()
    assert latest_path.exists()

    data = json.loads(latest_path.read_text(encoding="utf-8"))
    assert data["run_id"] == "video-test"
    assert data["summary"]["total"] == 2
    assert data["summary"]["submitted"] == 1
    assert data["items"][0]["id"] == "scn001_clip001"


def test_job_ledger_marks_failed_item(tmp_path: Path):
    ledger = JobLedger(tmp_path, kind="video.generate", run_id="video-test")

    ledger.start(stage="VIDEO", episode="ep001", total=1)
    ledger.update_item("scn001_clip001", status="failed", message="provider rejected")

    data = json.loads((tmp_path / ".agentos/jobs/video.generate/latest.json").read_text(encoding="utf-8"))
    assert data["status"] == "failed"
    assert data["summary"]["failed"] == 1
```

**Step 2: Run tests to verify failure**

```bash
uv run pytest .claude/skills/_shared/test_job_ledger.py -q
```

Expected: fails because `job_ledger.py` does not exist.

**Step 3: Implement writer**

Create `.claude/skills/_shared/job_ledger.py`:

```python
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class JobLedger:
    def __init__(self, project_dir: str | Path, *, kind: str, run_id: str):
        self.project_dir = Path(project_dir)
        self.kind = kind
        self.run_id = run_id
        self.dir = self.project_dir / ".agentos" / "jobs" / kind
        self.path = self.dir / f"{run_id}.json"
        self.latest_path = self.dir / "latest.json"
        self.data: dict[str, Any] | None = None

    def start(self, *, stage: str, episode: str | None = None, total: int = 0) -> None:
        now = utc_now()
        self.data = {
            "version": 1,
            "run_id": self.run_id,
            "kind": self.kind,
            "stage": stage,
            "episode": episode,
            "status": "running",
            "started_at": now,
            "updated_at": now,
            "summary": self._summary([], total),
            "items": [],
        }
        self._write()

    def update_item(self, item_id: str, *, status: str, **fields: Any) -> None:
        if self.data is None:
            raise RuntimeError("job ledger must be started before updating items")
        now = utc_now()
        items = self.data["items"]
        item = next((entry for entry in items if entry["id"] == item_id), None)
        if item is None:
            item = {"id": item_id, "created_at": now}
            items.append(item)
        item.update({key: value for key, value in fields.items() if value is not None})
        item["status"] = status
        item["updated_at"] = now
        if status == "submitted" and "submitted_at" not in item:
            item["submitted_at"] = now
        if status == "polling":
            item["last_poll_at"] = now

        self.data["updated_at"] = now
        self.data["summary"] = self._summary(items, self.data["summary"].get("total", len(items)))
        if any(entry.get("status") == "failed" for entry in items):
            self.data["status"] = "failed"
        elif items and all(entry.get("status") in TERMINAL_STATUSES for entry in items):
            self.data["status"] = "completed"
        else:
            self.data["status"] = "running"
        self._write()

    def _summary(self, items: list[dict[str, Any]], total: int) -> dict[str, int]:
        summary = {
            "total": total,
            "submitted": 0,
            "polling": 0,
            "downloading": 0,
            "reviewing": 0,
            "completed": 0,
            "failed": 0,
        }
        for item in items:
            status = item.get("status")
            if status in summary:
                summary[status] += 1
        return summary

    def _write(self) -> None:
        if self.data is None:
            raise RuntimeError("job ledger has no data")
        self.dir.mkdir(parents=True, exist_ok=True)
        self._atomic_write(self.path, self.data)
        self._atomic_write(self.latest_path, self.data)

    def _atomic_write(self, path: Path, data: dict[str, Any]) -> None:
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(tmp_name, path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
```

**Step 4: Run tests**

```bash
uv run pytest .claude/skills/_shared/test_job_ledger.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add .claude/skills/_shared/job_ledger.py .claude/skills/_shared/test_job_ledger.py
git commit -m "feat: add filesystem job ledger"
```

---

### Task 3: Instrument Video Generation Runtime

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py`
- Modify: `.claude/skills/video-gen/scripts/batch_generate_runtime.py`
- Modify: `.claude/skills/video-gen/scripts/video_api.py`
- Test: `.claude/skills/video-gen/scripts/test_duration_manifest.py`

**Step 1: Add a test for progress callbacks**

Extend `.claude/skills/video-gen/scripts/test_duration_manifest.py` with a test that uses fake submit/poll functions and asserts progress updates include `submitted`, `polling`, and `completed`.

Expected behavior:

- after submit: item status is `submitted`
- during poll: item status is `polling`
- after successful poll: item status is `downloading` then `completed` or `reviewing`

**Step 2: Run targeted test**

```bash
uv run pytest .claude/skills/video-gen/scripts/test_duration_manifest.py -q
```

Expected: fails until callbacks exist.

**Step 3: Add `on_progress` to `poll_multiple_tasks()`**

Modify `.claude/skills/video-gen/scripts/video_api.py`:

- Add parameter `on_progress: callable = None`.
- When each task is polled and still pending, call:

```python
on_progress({
    "task_id": task_id,
    "status": "polling",
    "provider_status": str(output.get("status") or "PENDING").upper(),
    "output_path": info.get("output_path"),
})
```

- When success result arrives before download, call `downloading`.
- On success after download, call `completed`.
- On failed or exception, call `failed`.

**Step 4: Wire ledger into `batch_generate.py`**

At VIDEO stage start, create a run id:

```python
run_id = f"video-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
ledger = JobLedger(project_root, kind="video.generate", run_id=run_id)
ledger.start(stage="VIDEO", episode=episode_key, total=len(clips))
```

Pass `ledger` or a narrow callback into runtime generation.

**Step 5: Write progress from `batch_generate_runtime.py`**

At each meaningful transition:

- before submit: `submitting`
- submit success: `submitted`, with `task_id`, `output_path`, model metadata
- submit failure: `failed`
- poll pending: `polling`, with `provider_status`
- download started: `downloading`
- review started: `reviewing`
- clip saved and accepted: `completed`
- review failed: keep generated file metadata, mark item `failed` with review message

**Step 6: Run tests**

```bash
uv run pytest .claude/skills/_shared/test_job_ledger.py .claude/skills/video-gen/scripts/test_duration_manifest.py -q
```

Expected: pass.

**Step 7: Commit**

```bash
git add .claude/skills/video-gen/scripts/batch_generate.py .claude/skills/video-gen/scripts/batch_generate_runtime.py .claude/skills/video-gen/scripts/video_api.py .claude/skills/video-gen/scripts/test_duration_manifest.py
git commit -m "feat(video): write aos-cli generation progress"
```

---

### Task 4: Expose Job Progress Through Console API

**Files:**
- Modify: `apps/console/src/server.ts`
- Create: `apps/console/src/lib/jobLedger.ts`
- Test: `apps/console/test/jobLedgerApi.test.ts`

**Step 1: Write parser tests**

Create `apps/console/src/lib/jobLedger.ts` with exported types later, and first write tests for:

- valid latest ledger returns normalized data
- missing ledger returns `null`
- invalid JSON returns `null`, not a server crash

**Step 2: Implement parser**

Implement:

```ts
export interface JobLedgerSummary {
  total: number;
  submitted: number;
  polling: number;
  downloading: number;
  reviewing: number;
  completed: number;
  failed: number;
}

export interface JobLedgerItem {
  id: string;
  status: string;
  task_id?: string;
  provider_status?: string;
  output_path?: string;
  message?: string;
  updated_at?: string;
}

export interface JobLedgerSnapshot {
  run_id: string;
  kind: string;
  stage: string;
  episode?: string | null;
  status: string;
  started_at?: string;
  updated_at?: string;
  summary: JobLedgerSummary;
  items: JobLedgerItem[];
}
```

**Step 3: Add API route**

Add:

```text
GET /api/projects/:project/jobs
GET /api/projects/:project/jobs/:kind
```

The first route returns all `latest.json` files under `.agentos/jobs/*/latest.json`. The second returns one kind.

**Step 4: Run console tests**

```bash
bun test apps/console/test/jobLedgerApi.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add apps/console/src/server.ts apps/console/src/lib/jobLedger.ts apps/console/test/jobLedgerApi.test.ts
git commit -m "feat(console): expose project job progress"
```

---

### Task 5: Render Progress in Overview and Video Workbench

**Files:**
- Create: `apps/console/src/components/Viewer/review/JobProgressStrip.tsx`
- Modify: `apps/console/src/contexts/ProjectContext.tsx`
- Modify: `apps/console/src/components/Viewer/views/OverviewView.tsx`
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Test: `apps/console/test/jobProgressRender.test.tsx`

**Step 1: Add context loading**

Extend project context to load `/api/projects/:project/jobs` during `refresh()`.

Keep this read-only and optional. If missing, UI renders nothing.

**Step 2: Create compact strip**

Create `JobProgressStrip`:

- title: `VIDEO · ep001`
- status: `running`, `completed`, or `failed`
- progress: `completed / total`
- secondary: `8 个轮询中 · 最近更新 18:41`
- failed message if any item failed

Do not render a large table by default.

**Step 3: Add Overview display**

In `OverviewView`, show the strip near pipeline progress when a running or recently updated ledger exists.

**Step 4: Add Storyboard/Video display**

In `StoryboardView`, show the strip above the bottom segment timeline when `kind === "video.generate"` and episode matches current episode.

**Step 5: Test render**

```bash
bun test apps/console/test/jobProgressRender.test.tsx
```

Expected: pass.

**Step 6: Commit**

```bash
git add apps/console/src/components/Viewer/review/JobProgressStrip.tsx apps/console/src/contexts/ProjectContext.tsx apps/console/src/components/Viewer/views/OverviewView.tsx apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/test/jobProgressRender.test.tsx
git commit -m "feat(console): show aos-cli job progress"
```

---

### Task 6: Teach the Agent to Read Job Progress

**Files:**
- Modify: `apps/console/src/orchestrator.ts`
- Modify: `apps/console/src/lib/scopedMessage.ts`
- Test: `apps/console/test/orchestratorSdk.test.ts`
- Test: `apps/console/test/scopedMessage.test.ts`

**Step 1: Add prompt rules**

Update Agent instructions:

```text
For progress questions, read pipeline-state.json first, then read .agentos/jobs/*/latest.json when present.
Use pipeline-state.json for stage-level status and job ledgers for provider task-level progress.
Never report all stages as pending if pipeline-state.json or job ledgers exist.
Do not invent provider queue rank; report submitted/polling/elapsed/last update instead.
```

**Step 2: Update tests**

Assert SDK prompt and scoped messages include `.agentos/jobs`.

**Step 3: Run tests**

```bash
bun test apps/console/test/orchestratorSdk.test.ts apps/console/test/scopedMessage.test.ts
```

Expected: pass.

**Step 4: Commit**

```bash
git add apps/console/src/orchestrator.ts apps/console/src/lib/scopedMessage.ts apps/console/test/orchestratorSdk.test.ts apps/console/test/scopedMessage.test.ts
git commit -m "feat(agent): include job ledgers in progress context"
```

---

### Task 7: End-to-End Verification

**Files:**
- No new source files expected.
- May create or inspect project-local runtime files under `workspace/<project>/.agentos/jobs/`.

**Step 1: Run Python tests**

```bash
uv run pytest .claude/skills/_shared/test_job_ledger.py .claude/skills/video-gen/scripts/test_duration_manifest.py -q
```

Expected: pass.

**Step 2: Run console tests**

```bash
bun test apps/console/test/jobLedgerApi.test.ts apps/console/test/jobProgressRender.test.tsx apps/console/test/orchestratorSdk.test.ts apps/console/test/scopedMessage.test.ts
```

Expected: pass.

**Step 3: Run a dry/fake video generation smoke test**

Use a small project with `AOS_CLI_MODEL_FAKE=1` if real provider credentials are unavailable. Confirm:

- `.agentos/jobs/video.generate/latest.json` appears.
- `summary.total` matches selected clip count.
- item statuses transition beyond `submitted`.
- generated `.mp4` files still land in existing output paths.
- `pipeline-state.json` remains stage-level and is still updated.

**Step 4: Browser verification**

Open the console and verify:

- Overview shows compact job progress.
- Storyboard/video page shows episode-specific job progress.
- Bottom segment timeline still uses real video file existence for playability.
- If provider is still polling, UI says polling instead of implying video exists.

**Step 5: Final commit**

```bash
git status --short
git commit -m "feat: surface aos-cli queue progress"
```

Only commit if there are staged changes from this task.

---

## Rollout Notes

- This plan deliberately avoids introducing a database or queue server.
- The filesystem ledger is append-compatible with future Server-Sent Events or WebSocket streaming.
- `pipeline-state.json` remains the stable stage contract.
- `.agentos/jobs` should be considered runtime state. Commit code and docs, not project runtime job files.
