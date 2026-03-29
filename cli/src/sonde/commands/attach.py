"""Attach command — upload files to experiments."""

from __future__ import annotations

import mimetypes
from pathlib import Path

import click

from sonde.auth import get_current_user
from sonde.db import rows
from sonde.db.client import get_client
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_json, print_success

# File extension → artifact type
_TYPE_MAP = {
    ".png": "figure",
    ".jpg": "figure",
    ".jpeg": "figure",
    ".svg": "figure",
    ".gif": "figure",
    ".pdf": "paper",
    ".nc": "dataset",
    ".jld2": "dataset",
    ".csv": "dataset",
    ".zarr": "dataset",
    ".ipynb": "notebook",
    ".yaml": "config",
    ".toml": "config",
    ".json": "config",
    ".log": "log",
    ".txt": "log",
}


def _infer_type(path: Path) -> str:
    return _TYPE_MAP.get(path.suffix.lower(), "other")


@click.command()
@click.argument("experiment_id")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True))
@click.option("--type", "artifact_type", help="Override artifact type")
@click.option("--description", "-d", help="Description of the artifact")
@click.pass_context
def attach(
    ctx: click.Context,
    experiment_id: str,
    files: tuple[str, ...],
    artifact_type: str | None,
    description: str | None,
) -> None:
    """Attach files to an experiment.

    \b
    Examples:
      sonde attach EXP-0001 figures/precip_delta.png
      sonde attach EXP-0001 report.pdf --type paper
      sonde attach EXP-0001 output/*.nc
    """
    experiment_id = experiment_id.upper()
    client = get_client()

    # Verify experiment exists
    exp_result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    if not rows(exp_result.data):
        print_error(
            f"Experiment {experiment_id} not found",
            "Cannot attach files to a nonexistent experiment.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    user = get_current_user()
    source = f"human/{user.email.split('@')[0]}" if user and not user.is_agent else "agent"

    # Generate artifact IDs
    id_result = (
        client.table("artifacts").select("id").order("created_at", desc=True).limit(1).execute()
    )
    existing = rows(id_result.data)
    next_num = int(existing[0]["id"].split("-")[1]) + 1 if existing else 1

    results = []
    for file_str in files:
        filepath = Path(file_str)
        art_id = f"ART-{next_num:04d}"
        next_num += 1

        storage_path = f"{experiment_id}/{filepath.name}"
        file_bytes = filepath.read_bytes()
        content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"
        upload_opts = {"content-type": content_type}

        # Upload to Supabase Storage
        try:
            client.storage.from_("artifacts").upload(storage_path, file_bytes, upload_opts)
        except Exception as e:
            if "Duplicate" in str(e) or "already exists" in str(e):
                client.storage.from_("artifacts").update(storage_path, file_bytes, upload_opts)
            else:
                print_error("Upload failed", str(e), f"Failed to upload {filepath.name}")
                continue

        # Create artifact record
        row = {
            "id": art_id,
            "filename": filepath.name,
            "type": artifact_type or _infer_type(filepath),
            "mime_type": mimetypes.guess_type(filepath.name)[0],
            "size_bytes": len(file_bytes),
            "description": description,
            "storage_path": storage_path,
            "experiment_id": experiment_id,
            "source": source,
        }
        client.table("artifacts").insert(row).execute()
        results.append(row)

        # Copy locally
        sonde_dir = find_sonde_dir()
        local_dir = ensure_subdir(sonde_dir, f"experiments/{experiment_id}")
        local_path = local_dir / filepath.name
        local_path.write_bytes(file_bytes)

        if not ctx.obj.get("json"):
            err.print(f"  [sonde.muted]{art_id} ← {filepath.name}[/]")

    if ctx.obj.get("json"):
        print_json(results)
    else:
        print_success(f"Attached {len(results)} file(s) to {experiment_id}")
