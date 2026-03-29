-- Create the storage bucket for artifacts
-- Files are stored here; metadata is in the artifacts table

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('artifacts', 'artifacts', false, 524288000);  -- 500MB limit per file
