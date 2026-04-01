"""Artifact commands — list files attached to experiments, findings, or directions."""

from __future__ import annotations

import mimetypes
from pathlib import Path

import click

from sonde.cli_options import pass_output_options
from sonde.commands._context import use_json
from sonde.output import err, print_error, print_json, print_success, print_table

__all__ = ["artifact"]


@click.group()
def artifact():
    """Artifact operations — list, annotate, and manage attached files."""


# Register subcommands
from sonde.commands.artifact_update import artifact_update  # noqa: E402

artifact.add_command(artifact_update)


@artifact.command("list")
@click.argument("parent_id")
@pass_output_options
@click.pass_context
def list_cmd(ctx: click.Context, parent_id: str) -> None:
    """List artifacts for an experiment (EXP-), finding (FIND-), or direction (DIR-).

    \b
    Examples:
      sonde artifact list EXP-0001
      sonde artifact list EXP-0001 --json
    """
    from sonde.db import artifacts as art_db

    rid = parent_id.strip().upper()
    prefix = rid.split("-")[0] if "-" in rid else ""

    if prefix == "EXP":
        data = art_db.list_artifacts(rid)
    elif prefix == "FIND":
        data = art_db.list_for_finding(rid)
    elif prefix == "DIR":
        data = art_db.list_for_direction(rid)
    else:
        print_error(
            "Invalid record id",
            f"Expected EXP-, FIND-, or DIR- prefix, got {parent_id!r}.",
            "Try: sonde artifact list EXP-0001",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(data)
        return

    if not data:
        err.print("[dim]No artifacts for this record.[/]")
        return

    print_table(
        ["id", "filename", "type", "size_bytes"],
        [
            {
                "id": row.get("id", ""),
                "filename": row.get("filename", ""),
                "type": row.get("type", ""),
                "size_bytes": row.get("size_bytes", ""),
            }
            for row in data
        ],
    )


def _parent_record_id(art: dict) -> tuple[str, str] | None:
    """Return (record_id, record_type) for the artifact's parent, or None."""
    if art.get("experiment_id"):
        return art["experiment_id"], "experiment"
    if art.get("direction_id"):
        return art["direction_id"], "direction"
    if art.get("finding_id"):
        return art["finding_id"], "finding"
    if art.get("project_id"):
        return art["project_id"], "project"
    return None


@artifact.command("delete")
@click.argument("artifact_ids", nargs=-1, required=True)
@click.option("--confirm", is_flag=True, help="Skip confirmation prompt")
@pass_output_options
@click.pass_context
def artifact_delete(ctx, artifact_ids, confirm):
    """Delete one or more artifacts.

    Removes the artifact record and its file from storage.

    \b
    Examples:
      sonde artifact delete ART-0001 --confirm
      sonde artifact delete ART-0001 ART-0002 ART-0003 --confirm
    """
    from sonde.db import artifacts as art_db
    from sonde.db.activity import log_activity

    json_mode = use_json(ctx)

    # Resolve and validate all artifacts first
    resolved = []
    for raw_id in artifact_ids:
        aid = raw_id.strip().upper()
        art = art_db.get(aid)
        if art is None:
            print_error(
                f"Artifact {aid} not found",
                "No artifact with this ID.",
                "List artifacts: sonde artifact list EXP-XXXX",
            )
            raise SystemExit(1)
        resolved.append(art)

    # Without --confirm, show what would be deleted and exit
    if not confirm:
        if json_mode:
            print_json(
                [
                    {
                        "id": a["id"],
                        "filename": a.get("filename", ""),
                        "parent": (
                            a.get("experiment_id")
                            or a.get("direction_id")
                            or a.get("finding_id")
                            or a.get("project_id")
                            or ""
                        ),
                    }
                    for a in resolved
                ]
            )
        else:
            err.print("[sonde.warning]The following artifacts will be deleted:[/]")
            for a in resolved:
                parent = (
                    a.get("experiment_id")
                    or a.get("direction_id")
                    or a.get("finding_id")
                    or a.get("project_id")
                    or "unknown"
                )
                err.print(f"  {a['id']}  {a.get('filename', '')}  (parent: {parent})")
            err.print("\nRe-run with [bold]--confirm[/] to proceed.")
        raise SystemExit(1)

    # Perform deletions
    deleted = []
    for art in resolved:
        aid = art["id"]
        art_db.delete(aid)
        deleted.append({"id": aid, "filename": art.get("filename", "")})

        parent = _parent_record_id(art)
        if parent:
            record_id, record_type = parent
            log_activity(
                record_id,
                record_type,
                "artifact_deleted",
                {"artifact_id": aid, "filename": art.get("filename", "")},
            )

    if json_mode:
        print_json({"deleted": deleted, "count": len(deleted)})
    else:
        print_success(f"Deleted {len(deleted)} artifact(s)")


@artifact.command("replace")
@click.argument("artifact_id")
@click.argument("file", type=click.Path(exists=True))
@click.option("-d", "--description", help="Update description too")
@pass_output_options
@click.pass_context
def artifact_replace(ctx, artifact_id, file, description):
    """Replace an artifact's file content.

    Uploads a new file to the same storage path, updating size and checksum.
    Optionally updates the description.

    \b
    Examples:
      sonde artifact replace ART-0001 updated_figure.png
      sonde artifact replace ART-0001 v2.png -d "Updated with error bars"
    """
    from sonde.db import artifacts as art_db
    from sonde.db.activity import log_activity
    from sonde.db.artifacts.storage import _write_storage_object
    from sonde.db.client import get_client

    json_mode = use_json(ctx)
    aid = artifact_id.strip().upper()

    existing = art_db.get(aid)
    if existing is None:
        print_error(
            f"Artifact {aid} not found",
            "No artifact with this ID.",
            "List artifacts: sonde artifact list EXP-XXXX",
        )
        raise SystemExit(1)

    filepath = Path(file)
    storage_path = existing["storage_path"]
    file_size = filepath.stat().st_size

    if file_size > art_db.MAX_ARTIFACT_SIZE_BYTES:
        size_mb = file_size / (1024 * 1024)
        limit_mb = art_db.MAX_ARTIFACT_SIZE_BYTES / (1024 * 1024)
        print_error(
            "File too large",
            f"{filepath.name} is {size_mb:.1f} MB, over the {limit_mb:.0f} MB limit.",
            "Use the dataset/S3 workflow for larger outputs.",
        )
        raise SystemExit(1)

    content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"
    checksum = art_db.compute_checksum(filepath)

    # Replace the blob in storage
    client = get_client()
    _write_storage_object(
        client,
        "update",
        storage_path,
        filepath,
        content_type,
    )

    # Build metadata updates
    updates: dict = {
        "filename": filepath.name,
        "size_bytes": file_size,
        "mime_type": content_type,
        "checksum_sha256": checksum,
        "type": art_db.infer_type(filepath),
    }
    if description is not None:
        updates["description"] = description

    updated = art_db.update_metadata(aid, updates)

    # Log activity on parent record
    parent = _parent_record_id(existing)
    if parent:
        record_id, record_type = parent
        log_activity(
            record_id,
            record_type,
            "artifact_replaced",
            {"artifact_id": aid, "filename": filepath.name},
        )

    if json_mode:
        print_json(updated)
    else:
        print_success(f"Replaced {aid}")
