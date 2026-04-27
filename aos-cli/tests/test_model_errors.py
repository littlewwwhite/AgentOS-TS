import pytest

from aos_cli.model.errors import (
    ARTIFACT_ERROR,
    AUTH_ERROR,
    CANONICAL_ERROR_CODES,
    CONFIG_ERROR,
    INTERNAL_ERROR,
    INVALID_REQUEST,
    LEGACY_ERROR_CODE_MAP,
    PROVIDER_REJECTED,
    PROVIDER_TIMEOUT,
    PROVIDER_UNAVAILABLE,
    RATE_LIMITED,
    RETRYABLE_ERROR_CODES,
    UNSUPPORTED_CAPABILITY,
    UNSUPPORTED_OUTPUT_KIND,
    ModelServiceError,
    canonical_error_code,
)


def test_canonical_error_codes_match_minimal_taxonomy():
    assert CANONICAL_ERROR_CODES == (
        INVALID_REQUEST,
        UNSUPPORTED_CAPABILITY,
        UNSUPPORTED_OUTPUT_KIND,
        CONFIG_ERROR,
        AUTH_ERROR,
        RATE_LIMITED,
        PROVIDER_TIMEOUT,
        PROVIDER_REJECTED,
        PROVIDER_UNAVAILABLE,
        ARTIFACT_ERROR,
        INTERNAL_ERROR,
    )


def test_retryable_error_codes_match_policy():
    assert RETRYABLE_ERROR_CODES == {
        RATE_LIMITED,
        PROVIDER_TIMEOUT,
        PROVIDER_UNAVAILABLE,
    }


def test_model_service_error_defaults_retryable_from_code():
    assert ModelServiceError(RATE_LIMITED, "rate limited").retryable is True
    assert ModelServiceError(PROVIDER_TIMEOUT, "timed out").retryable is True
    assert ModelServiceError(PROVIDER_UNAVAILABLE, "unavailable").retryable is True
    assert ModelServiceError(INVALID_REQUEST, "bad request").retryable is False


def test_model_service_error_explicit_retryable_overrides_default():
    assert ModelServiceError(RATE_LIMITED, "rate limited", retryable=False).retryable is False
    assert ModelServiceError(INVALID_REQUEST, "bad request", retryable=True).retryable is True


def test_legacy_error_code_map_matches_expected_canonical_mapping():
    assert LEGACY_ERROR_CODE_MAP == {
        "PROVIDER_AUTH_FAILED": AUTH_ERROR,
        "PROVIDER_QUOTA_EXHAUSTED": RATE_LIMITED,
        "PROVIDER_BAD_RESPONSE": PROVIDER_REJECTED,
        "OUTPUT_PARSE_FAILED": PROVIDER_REJECTED,
    }


@pytest.mark.parametrize(
    ("legacy_code", "canonical_code"),
    [
        ("PROVIDER_AUTH_FAILED", AUTH_ERROR),
        ("PROVIDER_QUOTA_EXHAUSTED", RATE_LIMITED),
        ("PROVIDER_BAD_RESPONSE", PROVIDER_REJECTED),
        ("OUTPUT_PARSE_FAILED", PROVIDER_REJECTED),
    ],
)
def test_canonical_error_code_normalizes_legacy_codes(legacy_code: str, canonical_code: str):
    assert canonical_error_code(legacy_code) == canonical_code
    assert canonical_error_code(canonical_code) == canonical_code
    assert canonical_code in CANONICAL_ERROR_CODES


def test_canonical_error_code_preserves_unknown_codes():
    assert canonical_error_code("SOME_FUTURE_CODE") == "SOME_FUTURE_CODE"
    assert canonical_error_code(INVALID_REQUEST) == INVALID_REQUEST
    assert INVALID_REQUEST in CANONICAL_ERROR_CODES
