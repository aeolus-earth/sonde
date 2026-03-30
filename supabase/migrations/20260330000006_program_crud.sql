-- Program CRUD: archive support and server-side RPCs with RBAC.

-- Archive support
ALTER TABLE programs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS archived_by TEXT;


-- ---------------------------------------------------------------------------
-- RPC: create_program (any authenticated user)
-- Creator is automatically granted admin role on the new program.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_program(
    program_id TEXT,
    program_name TEXT,
    program_description TEXT DEFAULT NULL
)
RETURNS programs
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    caller_id UUID := auth.uid();
    result programs;
BEGIN
    INSERT INTO programs (id, name, description)
    VALUES (program_id, program_name, program_description)
    RETURNING * INTO result;

    -- Auto-grant admin role to creator
    INSERT INTO user_programs (user_id, program, role)
    VALUES (caller_id, program_id, 'admin');

    RETURN result;
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: archive_program (requires admin role on that program)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION archive_program(target_program TEXT)
RETURNS programs
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    caller_id UUID := auth.uid();
    is_program_admin BOOLEAN;
    result programs;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_programs
        WHERE user_id = caller_id AND program = target_program AND role = 'admin'
    ) INTO is_program_admin;

    IF NOT coalesce(is_program_admin, false) THEN
        RAISE EXCEPTION 'Only program admins can archive programs'
            USING ERRCODE = '42501';
    END IF;

    UPDATE programs
    SET archived_at = now(),
        archived_by = coalesce(
            current_setting('request.jwt.claims', true)::jsonb ->> 'email',
            'unknown'
        )
    WHERE id = target_program AND archived_at IS NULL
    RETURNING * INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION 'Program not found or already archived';
    END IF;

    RETURN result;
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: unarchive_program (requires admin role on that program)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION unarchive_program(target_program TEXT)
RETURNS programs
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    caller_id UUID := auth.uid();
    is_program_admin BOOLEAN;
    result programs;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_programs
        WHERE user_id = caller_id AND program = target_program AND role = 'admin'
    ) INTO is_program_admin;

    IF NOT coalesce(is_program_admin, false) THEN
        RAISE EXCEPTION 'Only program admins can unarchive programs'
            USING ERRCODE = '42501';
    END IF;

    UPDATE programs
    SET archived_at = NULL, archived_by = NULL
    WHERE id = target_program AND archived_at IS NOT NULL
    RETURNING * INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION 'Program not found or not archived';
    END IF;

    RETURN result;
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: delete_program (requires global admin — is_admin in any program)
-- Cascade-deletes ALL child records to prevent orphans.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_program(target_program TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    caller_id UUID := auth.uid();
    is_global_admin BOOLEAN;
BEGIN
    SELECT bool_or(role = 'admin') INTO is_global_admin
    FROM user_programs WHERE user_id = caller_id;

    IF NOT coalesce(is_global_admin, false) THEN
        RAISE EXCEPTION 'Only global admins can delete programs'
            USING ERRCODE = '42501';
    END IF;

    -- Verify program exists
    IF NOT EXISTS (SELECT 1 FROM programs WHERE id = target_program) THEN
        RAISE EXCEPTION 'Program % not found', target_program;
    END IF;

    -- Cascade delete in FK-safe order
    DELETE FROM activity_log WHERE record_id IN (
        SELECT id FROM experiments WHERE program = target_program
        UNION ALL SELECT id FROM findings WHERE program = target_program
        UNION ALL SELECT id FROM questions WHERE program = target_program
        UNION ALL SELECT id FROM directions WHERE program = target_program
    );
    DELETE FROM experiment_notes WHERE experiment_id IN (
        SELECT id FROM experiments WHERE program = target_program
    );
    DELETE FROM artifacts WHERE experiment_id IN (
        SELECT id FROM experiments WHERE program = target_program
    );
    DELETE FROM findings WHERE program = target_program;
    DELETE FROM questions WHERE program = target_program;
    DELETE FROM experiments WHERE program = target_program;
    DELETE FROM directions WHERE program = target_program;
    DELETE FROM user_programs WHERE program = target_program;
    DELETE FROM programs WHERE id = target_program;
END;
$$;


-- Grants
GRANT EXECUTE ON FUNCTION create_program(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_program(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION unarchive_program(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_program(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
