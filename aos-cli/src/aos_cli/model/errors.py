# input: stable model-service error details
# output: exception objects that can be converted into response envelopes
# pos: shared error type for model service core and provider adapters

INVALID_REQUEST = "INVALID_REQUEST"
UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY"
UNSUPPORTED_OUTPUT_KIND = "UNSUPPORTED_OUTPUT_KIND"
CONFIG_ERROR = "CONFIG_ERROR"
AUTH_ERROR = "AUTH_ERROR"
RATE_LIMITED = "RATE_LIMITED"
PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
PROVIDER_REJECTED = "PROVIDER_REJECTED"
PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
ARTIFACT_ERROR = "ARTIFACT_ERROR"
INTERNAL_ERROR = "INTERNAL_ERROR"

CANONICAL_ERROR_CODES = (
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

RETRYABLE_ERROR_CODES = {
    RATE_LIMITED,
    PROVIDER_TIMEOUT,
    PROVIDER_UNAVAILABLE,
}

LEGACY_ERROR_CODE_MAP = {
    "PROVIDER_AUTH_FAILED": AUTH_ERROR,
    "PROVIDER_QUOTA_EXHAUSTED": RATE_LIMITED,
    "PROVIDER_BAD_RESPONSE": PROVIDER_REJECTED,
    "OUTPUT_PARSE_FAILED": PROVIDER_REJECTED,
}


def canonical_error_code(code: str) -> str:
    return LEGACY_ERROR_CODE_MAP.get(code, code)


class ModelServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool | None = None,
        provider: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = code in RETRYABLE_ERROR_CODES if retryable is None else retryable
        self.provider = provider
        self.status_code = status_code


__all__ = [
    "ARTIFACT_ERROR",
    "AUTH_ERROR",
    "CANONICAL_ERROR_CODES",
    "CONFIG_ERROR",
    "INTERNAL_ERROR",
    "INVALID_REQUEST",
    "LEGACY_ERROR_CODE_MAP",
    "ModelServiceError",
    "PROVIDER_REJECTED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_UNAVAILABLE",
    "RATE_LIMITED",
    "RETRYABLE_ERROR_CODES",
    "UNSUPPORTED_CAPABILITY",
    "UNSUPPORTED_OUTPUT_KIND",
    "canonical_error_code",
]
