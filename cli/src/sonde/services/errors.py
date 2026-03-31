"""Service-layer exceptions."""

from __future__ import annotations


class WorkflowError(RuntimeError):
    """Raised when a multi-step workflow cannot complete safely."""

    def __init__(self, what: str, why: str, fix: str) -> None:
        super().__init__(what)
        self.what = what
        self.why = why
        self.fix = fix
