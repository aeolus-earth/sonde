-- Harden artifact sync semantics.
-- One storage path should map to one logical artifact row.

ALTER TABLE artifacts
    ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

WITH ranked AS (
    SELECT
        ctid,
        row_number() OVER (
            PARTITION BY storage_path
            ORDER BY created_at DESC, id DESC
        ) AS row_num
    FROM artifacts
)
DELETE FROM artifacts a
USING ranked r
WHERE a.ctid = r.ctid
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_storage_path_unique
    ON artifacts (storage_path);
