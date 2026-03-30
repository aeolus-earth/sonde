"""Access command — check and report subsystem credentials.

Tells agents what subsystems are configured and whether credentials
are available. Does not issue or manage credentials — just reports
what's reachable so agents can write their own scripts.
"""

from __future__ import annotations

import os

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
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
    settings = get_settings()

    config: dict[str, str | None] = {
        "bucket": settings.s3_bucket or None,
        "prefix": settings.s3_prefix or None,
        "region": settings.s3_region,
    }

    # Check for AWS credentials in environment
    has_key = bool(os.environ.get("AWS_ACCESS_KEY_ID"))
    has_profile = bool(os.environ.get("AWS_PROFILE"))
    has_role = bool(os.environ.get("AWS_ROLE_ARN"))

    if has_key:
        config["credentials"] = "environment (AWS_ACCESS_KEY_ID)"
    elif has_profile:
        config["credentials"] = f"profile ({os.environ['AWS_PROFILE']})"
    elif has_role:
        config["credentials"] = f"role ({os.environ['AWS_ROLE_ARN']})"
    else:
        # Check for instance metadata / default credential chain
        try:
            import boto3

            session = boto3.Session()
            creds = session.get_credentials()
            if creds:
                config["credentials"] = "available (default chain)"
            else:
                config["credentials"] = None
        except ImportError:
            config["credentials"] = None

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if config["credentials"]:
            print_success(f"S3 credentials: {config['credentials']}")
        else:
            print_error(
                "No S3 credentials found",
                (
                    "Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, AWS_PROFILE, "
                    "or configure an instance role."
                ),
                "Agents need S3 credentials to load/store large datasets.",
            )
        if config["bucket"]:
            err.print(f"  Bucket: {config['bucket']}")
        if config["prefix"]:
            err.print(f"  Prefix: {config['prefix']}")
        err.print(f"  Region: {config['region']}")
        if not config["bucket"]:
            err.print("  [sonde.muted]No bucket configured. Set s3.bucket in .aeolus.yaml[/]")


@access.command()
@pass_output_options
@click.pass_context
def icechunk(ctx: click.Context) -> None:
    """Check Icechunk access configuration.

    \b
    Examples:
      sonde access icechunk
    """
    settings = get_settings()

    config: dict[str, str | None] = {
        "repo": settings.icechunk_repo or None,
    }

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if config["repo"]:
            print_success(f"Icechunk repo: {config['repo']}")
        else:
            err.print(
                "[sonde.muted]No Icechunk repo configured. Set icechunk.repo in .aeolus.yaml[/]"
            )


@access.command()
@pass_output_options
@click.pass_context
def stac(ctx: click.Context) -> None:
    """Check STAC catalog configuration.

    \b
    Examples:
      sonde access stac
    """
    settings = get_settings()

    config: dict[str, str | None] = {
        "catalog_url": settings.stac_catalog_url or None,
    }

    if ctx.obj.get("json"):
        print_json(config)
    else:
        if config["catalog_url"]:
            print_success(f"STAC catalog: {config['catalog_url']}")
        else:
            err.print(
                "[sonde.muted]No STAC catalog configured. Set stac.catalog_url in .aeolus.yaml[/]"
            )
