# input: video-gen scene scheduler and per-scene generation loop
# output: regression assertions for scene-level parallelism and in-scene ordering
# pos: scheduling contract coverage for VIDEO generation

import threading


def test_process_scenes_parallel_starts_independent_scenes_concurrently():
    import batch_generate_runtime as runtime

    started = []
    finished = []
    lock = threading.Lock()
    both_started = threading.Event()

    def fake_process_scene(scene_id, clips):
        with lock:
            started.append(scene_id)
            if len(started) == 2:
                both_started.set()
        assert both_started.wait(timeout=1), "scene processing did not overlap"
        with lock:
            finished.append(scene_id)

    runtime.process_scenes_parallel(
        scenes_clip_states={
            "scn_001": [{"scene_id": "scn_001"}],
            "scn_002": [{"scene_id": "scn_002"}],
        },
        process_scene=fake_process_scene,
    )

    assert sorted(started) == ["scn_001", "scn_002"]
    assert sorted(finished) == ["scn_001", "scn_002"]


def test_process_scene_clips_runs_clips_in_order_and_carries_provider_tail_frame(monkeypatch):
    import batch_generate_runtime as runtime

    calls = []

    def fake_run_generation_rounds(**kwargs):
        clip_group = kwargs["clip_group"]
        calls.append((clip_group[0]["clip_num"], kwargs["first_frame_url"]))
        return f"/tmp/clip-{clip_group[0]['clip_num']}.mp4", f"tail-{clip_group[0]['clip_num']}"

    monkeypatch.setattr(runtime, "_run_generation_rounds", fake_run_generation_rounds)
    monkeypatch.setattr(
        runtime,
        "_extract_and_upload_frame",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("provider tail frame should be reused")),
    )

    clips = [
        {
            "ls_id": "scn001_clip002",
            "scene_id": "scn_001",
            "clip_num": 2,
        },
        {
            "ls_id": "scn001_clip001",
            "scene_id": "scn_001",
            "clip_num": 1,
        },
    ]

    runtime._process_scene_clips(
        scene_id="scn_001",
        scene_clip_states=clips,
        episode=1,
        paths=None,
        model_code="fake-model",
        quality="720",
        ratio="16:9",
        poll_interval=0,
        timeout=1,
        gemini_api_key=None,
        skip_review=True,
    )

    assert calls == [(1, None), (2, "tail-1")]
    assert clips[0]["prev_frame_url"] == "tail-1"
