# input: video-gen batch summary counters
# output: regression assertions for pipeline-state outcome selection
# pos: unit coverage for VIDEO stage completion semantics


def test_video_generation_outcome_marks_all_failed_batch_as_failed_without_delivery():
    from batch_generate import _video_generation_outcome

    outcome = _video_generation_outcome(success_count=0, fail_count=6)

    assert outcome["stage_status"] == "failed"
    assert outcome["episode_status"] == "failed"
    assert outcome["write_delivery"] is False
    assert outcome["next_action"] == "retry VIDEO"


def test_video_generation_outcome_keeps_partial_delivery_for_mixed_batch():
    from batch_generate import _video_generation_outcome

    outcome = _video_generation_outcome(success_count=2, fail_count=1)

    assert outcome["stage_status"] == "partial"
    assert outcome["episode_status"] == "partial"
    assert outcome["write_delivery"] is True
    assert outcome["next_action"] == "review VIDEO"


def test_video_generation_outcome_marks_full_success_completed():
    from batch_generate import _video_generation_outcome

    outcome = _video_generation_outcome(success_count=3, fail_count=0)

    assert outcome["stage_status"] == "partial"
    assert outcome["episode_status"] == "completed"
    assert outcome["write_delivery"] is True
    assert outcome["next_action"] == "review VIDEO"
