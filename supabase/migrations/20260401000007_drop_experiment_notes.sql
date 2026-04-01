-- Drop the legacy experiment_notes table.
-- All data was migrated to the polymorphic `notes` table in 20260401000003.
-- All code now reads/writes the `notes` table exclusively.

DROP TABLE IF EXISTS experiment_notes;
DROP SEQUENCE IF EXISTS note_id_seq;
