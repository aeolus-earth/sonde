"""Artifact database, storage, and maintenance operations.

Split into submodules for clarity:
- crud.py: DB read/write operations
- storage.py: Supabase bucket upload/download
- inference.py: Type maps, MIME handling, constants
- maintenance.py: Delete queue, reconciliation, audit
"""

# Re-export public API so existing `from sonde.db.artifacts import X` works unchanged.

from sonde.db.artifacts.crud import (
    delete,
    find_by_path,
    find_by_storage_path,
    get,
    list_artifacts,
    list_for_direction,
    list_for_experiments,
    list_for_finding,
    list_for_project,
    update_metadata,
)
from sonde.db.artifacts.inference import (
    ARTIFACT_BUCKET,
    MAX_ARTIFACT_SIZE_BYTES,
    ArtifactTooLargeError,
    TEXT_EXTENSIONS,
    TEXT_MIME_PREFIXES,
    TEXT_MIME_TYPES,
    infer_type,
    is_text_artifact,
)
from sonde.db.artifacts.maintenance import (
    audit_artifact_sync,
    finalize_deleted_artifacts,
    list_delete_queue,
    reconcile_delete_queue,
)
from sonde.db.artifacts.storage import (
    compute_checksum,
    download_file,
    upload_file,
)

__all__ = [
    # Constants
    "ARTIFACT_BUCKET",
    "MAX_ARTIFACT_SIZE_BYTES",
    "ArtifactTooLargeError",
    "TEXT_EXTENSIONS",
    "TEXT_MIME_PREFIXES",
    "TEXT_MIME_TYPES",
    # Inference
    "infer_type",
    "is_text_artifact",
    # CRUD
    "list_artifacts",
    "list_for_finding",
    "list_for_direction",
    "list_for_project",
    "list_for_experiments",
    "get",
    "find_by_path",
    "find_by_storage_path",
    "update_metadata",
    "delete",
    # Storage
    "compute_checksum",
    "download_file",
    "upload_file",
    # Maintenance
    "list_delete_queue",
    "finalize_deleted_artifacts",
    "reconcile_delete_queue",
    "audit_artifact_sync",
]
