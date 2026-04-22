# Production Backup And Recovery

This runbook explains how Sonde production backups work, how to verify that a
backup exists, and how to perform a safe restore into a fresh recovery project.

Use this during an incident. The safest default is always: restore into a new
Supabase project first, verify the data, and only then decide whether to copy
records back or repoint production services.

## What Runs Automatically

Production backups are created by the GitHub Actions workflow named
`Production Backup Archive`.

- Workflow file: `.github/workflows/production-backup.yml`
- Schedule: daily at `09:31 UTC`
- Default retention: 14 daily snapshots
- Source: production Supabase project
- Destination: separate backup Supabase project
- Backup bucket: `sonde-production-backups`
- Backup prefix: `production/<snapshot-id>/`
- Latest pointer: `production/latest.json`
- Encryption: `age`
- Decrypt identity: stored in 1Password as `Sonde Production Backup Recovery`

Each successful snapshot contains:

- Supabase roles dump: `database/roles.sql`
- Supabase schema dump: `database/schema.sql`
- Supabase data dump: `database/data.sql`
- Storage objects from the production `artifacts` bucket
- `manifest.json`
- `RECOVERY.md`
- Encrypted archive parts uploaded to the backup bucket

## Manual Backup

Use a manual backup before risky maintenance or after changing backup behavior.

1. Open GitHub Actions.
2. Select `Production Backup Archive`.
3. Choose `Run workflow`.
4. Select branch `main`.
5. Keep the default inputs unless there is a specific reason to change them.

The default inputs are:

- `retention_days`: `14`
- `part_size_bytes`: `104857600`

A successful run uploads a sanitized GitHub artifact named
`production-backup-summary`. It also writes a new snapshot to the backup
Supabase project.

## Verify A Backup Exists

A backup is usable only after the workflow succeeds.

Check GitHub first:

1. Open the latest `Production Backup Archive` run.
2. Confirm the run status is success.
3. Open the `production-backup-summary` artifact.
4. Confirm it reports a backup prefix, artifact count, database dump sizes, and
   encrypted archive parts.

Check Supabase next:

1. Open the backup Supabase project.
2. Open Storage.
3. Open bucket `sonde-production-backups`.
4. Confirm `production/latest.json` exists.
5. Open the snapshot prefix from `latest.json`.
6. Confirm `manifest.json` and encrypted archive part files exist.

If the workflow fails before a restorable snapshot is produced, it should upload
a sanitized `failure.md` artifact explaining the failing phase.

## Safe Restore Path

Do not restore directly over production during normal recovery. Create a fresh
Supabase project and restore there first.

1. Create a new Supabase recovery project.
2. Configure it like production enough for validation.
3. Create or confirm the target `artifacts` storage bucket.
4. Get the `age` private decrypt identity from 1Password:
   `Sonde Production Backup Recovery`.
5. Get the backup project service role key from GitHub or the Supabase backup
   project.
6. Get the target recovery project service role key.
7. Get the target recovery database connection URL.
8. Run a dry-run restore first.
9. Inspect `production-backup-restore/restore-summary.json`.
10. Only then run an apply restore into the recovery project.

Dry-run restore:

```bash
SONDE_RESTORE_TARGET_PROJECT_REF="<fresh-recovery-project-ref>" \
SONDE_RESTORE_TARGET_SUPABASE_URL="https://<fresh-recovery-project-ref>.supabase.co" \
SONDE_RESTORE_TARGET_SERVICE_ROLE_KEY="<fresh-recovery-service-role-key>" \
SONDE_RESTORE_TARGET_DB_URL="<fresh-recovery-postgres-url>" \
SUPABASE_BACKUP_PROJECT_REF="<backup-project-ref>" \
SUPABASE_BACKUP_SERVICE_ROLE_KEY="<backup-service-role-key>" \
SUPABASE_BACKUP_BUCKET="sonde-production-backups" \
SONDE_BACKUP_AGE_IDENTITY_FILE="<path-to-age-identity-file>" \
node server/scripts/supabase-production-backup.mjs restore
```

Apply restore into the fresh recovery project:

```bash
SONDE_RESTORE_APPLY=1 \
SONDE_RESTORE_TARGET_PROJECT_REF="<fresh-recovery-project-ref>" \
SONDE_RESTORE_TARGET_SUPABASE_URL="https://<fresh-recovery-project-ref>.supabase.co" \
SONDE_RESTORE_TARGET_SERVICE_ROLE_KEY="<fresh-recovery-service-role-key>" \
SONDE_RESTORE_TARGET_DB_URL="<fresh-recovery-postgres-url>" \
SUPABASE_BACKUP_PROJECT_REF="<backup-project-ref>" \
SUPABASE_BACKUP_SERVICE_ROLE_KEY="<backup-service-role-key>" \
SUPABASE_BACKUP_BUCKET="sonde-production-backups" \
SONDE_BACKUP_AGE_IDENTITY_FILE="<path-to-age-identity-file>" \
node server/scripts/supabase-production-backup.mjs restore
```

The restore command refuses to restore over the source production project unless
`SONDE_RESTORE_ALLOW_SOURCE_OVERWRITE=1` is also set. Treat that override as an
explicit emergency-only action requiring human review.

## Validate Restored Data

After restoring into the recovery project:

1. Confirm the command reports `Database restore: applied`.
2. Confirm the command reports storage objects were applied.
3. Compare important table counts against the source backup manifest.
4. Spot-check high-value projects, experiments, findings, notes, and artifacts.
5. Open several artifact files from the recovered `artifacts` bucket.
6. Only after validation, decide whether to copy data back into production,
   export selected rows, or repoint an app to the recovery project.

## Schema Changes

Backups do not apply migrations. They capture the live production schema, data,
and artifacts at the time the backup runs.

Schema deployment is handled by separate workflows:

- Staging: `Sync Staging Infra`
- Production: `Sync Production Infra`

If a code change needs database changes, add a migration under
`supabase/migrations/`. The infra workflows apply migrations when `supabase/**`
changes land on `staging` and then `main`.

Avoid making manual production schema changes in the Supabase dashboard. A
manual change will be captured by backups, but it will not be represented in
git, so future migrations and recovery work become harder to reason about.

## Emergency Rules

- Do not delete production data while trying to recover production data.
- Do not restore directly over production unless there is an explicit emergency
  approval.
- Do not paste decrypt identities, service role keys, or database passwords into
  issue comments, PR comments, Slack, or chat.
- Use a fresh recovery project first.
- Keep the 1Password item `Sonde Production Backup Recovery` current.
- If a workflow fails, read the uploaded failure artifact before rerunning.
