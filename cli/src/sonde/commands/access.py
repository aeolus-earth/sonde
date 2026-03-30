"""Access command — check and report subsystem readiness."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.diagnostics import check_icechunk_settings, check_s3_settings, check_stac_settings
from sonde.output import err, print_error, print_json, print_success


@click.group()
def access():
    """Check access to data subsystems (S3, Icechunk, STAC)."""


@access.command()
@pass_output_options
@click.pass_context
def s3(ctx: click.Context) -> None:
    """Check S3 access configuration.

    Reports whether AWS credentials are available and what bucket/prefix
    is configured. Agents use this to know where to point their scripts.

    \b
    Examples:
      sonde access s3
      sonde access s3 --json
    """
    check = check_s3_settings()
    config: dict[str, str | None] = {
        "bucket": check.metadata.get("bucket"),
        "prefix": check.metadata.get("prefix"),
        "region": check.details[0].removeprefix("Region: ") if check.details else None,
        "credentials": check.metadata.get("credentials"),
        "status": check.status,
        "summary": check.summary,
    }

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if check.status == "ok":
            print_success(check.summary)
        elif check.status == "warn":
            print_error("S3 setup is incomplete", check.summary, check.fix or "sonde access s3")
        else:
            err.print(f"[sonde.muted]{check.summary}[/]")
        for detail in check.details:
            err.print(f"  {detail}")


@access.command()
@pass_output_options
@click.pass_context
def icechunk(ctx: click.Context) -> None:
    """Check Icechunk access configuration.

    \b
    Examples:
      sonde access icechunk
    """
    check = check_icechunk_settings()
    config: dict[str, str | None] = {
        "repo": check.metadata.get("repo"),
        "status": check.status,
        "summary": check.summary,
    }

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if check.status == "ok":
            print_success(check.summary)
        else:
            err.print(f"[sonde.muted]{check.summary}[/]")
        for detail in check.details:
            err.print(f"  {detail}")


@access.command()
@pass_output_options
@click.pass_context
def stac(ctx: click.Context) -> None:
    """Check STAC catalog configuration.

    \b
    Examples:
      sonde access stac
    """
    check = check_stac_settings(deep=False)
    config: dict[str, str | None] = {
        "catalog_url": check.metadata.get("catalog_url"),
        "status": check.status,
        "summary": check.summary,
    }

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if check.status == "ok":
            print_success(check.summary)
        else:
            err.print(f"[sonde.muted]{check.summary}[/]")
        for detail in check.details:
            err.print(f"  {detail}")
