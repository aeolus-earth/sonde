-- Fix recursive RLS on user_programs.
-- The admin policy was querying user_programs to check admin status,
-- causing infinite recursion. Instead, read is_admin from the JWT
-- (set by the custom_access_token_hook at login time).

DROP POLICY IF EXISTS "user_programs_admin_all" ON user_programs;

CREATE POLICY "user_programs_admin_all" ON user_programs
    FOR ALL USING (
        coalesce(
            (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
            false
        )
    );
