-- Git provenance: capture close-time commit and dirty state.
-- Creation-time provenance (git_commit, git_repo, git_branch) already exists.

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS git_close_commit TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS git_close_branch TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS git_dirty BOOLEAN;
