-- UI prune and bulk-close helpers.
-- Powers question/finding deletion and experiment close/archive flows directly from the web UI.

CREATE OR REPLACE FUNCTION public.current_actor_identity()
RETURNS TABLE (
    actor text,
    actor_email text,
    actor_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb := auth.jwt();
    app_meta jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
    user_meta jsonb := coalesce(claims -> 'user_metadata', '{}'::jsonb);
    caller_id uuid := auth.uid();
    is_agent boolean := coalesce((app_meta ->> 'agent')::boolean, false);
    actor_value text;
    email_value text;
    name_value text;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required'
            USING ERRCODE = '42501';
    END IF;

    email_value := nullif(coalesce(claims ->> 'email', user_meta ->> 'email'), '');
    name_value := nullif(coalesce(user_meta ->> 'full_name', user_meta ->> 'name'), '');

    IF is_agent THEN
        actor_value := 'agent/' || coalesce(
            nullif(app_meta ->> 'agent_name', ''),
            nullif(app_meta ->> 'token_name', ''),
            nullif(claims ->> 'name', ''),
            left(caller_id::text, 8)
        );
        email_value := NULL;
    ELSE
        IF email_value IS NULL THEN
            actor_value := 'human/' || left(caller_id::text, 8);
        ELSE
            actor_value := 'human/' || split_part(email_value, '@', 1);
        END IF;
    END IF;

    RETURN QUERY
    SELECT actor_value, email_value, name_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_questions(target_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_value text;
    actor_email_value text;
    actor_name_value text;
    target_id text;
    requested_count integer := 0;
    applied_count integer := 0;
    skipped_count integer := 0;
    applied jsonb := '[]'::jsonb;
    skipped jsonb := '[]'::jsonb;
    question_row public.questions%ROWTYPE;
BEGIN
    SELECT actor, actor_email, actor_name
    INTO actor_value, actor_email_value, actor_name_value
    FROM public.current_actor_identity();

    FOR target_id IN
        SELECT DISTINCT upper(btrim(value))
        FROM unnest(coalesce(target_ids, ARRAY[]::text[])) AS value
        WHERE nullif(btrim(value), '') IS NOT NULL
        ORDER BY 1
    LOOP
        requested_count := requested_count + 1;

        BEGIN
            SELECT *
            INTO question_row
            FROM public.questions
            WHERE id = target_id;

            IF NOT FOUND THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'not_found',
                        'message', 'Question not found.'
                    )
                );
                CONTINUE;
            END IF;

            IF NOT public.can_access_record(target_id, 'question') THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'access_denied',
                        'message', 'You do not have access to this question.'
                    )
                );
                CONTINUE;
            END IF;

            INSERT INTO public.activity_log (
                record_id,
                record_type,
                action,
                actor,
                actor_email,
                actor_name,
                details
            )
            VALUES (
                target_id,
                'question',
                'deleted',
                actor_value,
                actor_email_value,
                actor_name_value,
                jsonb_build_object('deleted_by', actor_value)
            );

            DELETE FROM public.questions
            WHERE id = target_id;

            applied_count := applied_count + 1;
            applied := applied || jsonb_build_array(
                jsonb_build_object('id', target_id)
            );
        EXCEPTION
            WHEN OTHERS THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'delete_failed',
                        'message', SQLERRM
                    )
                );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'applied', applied,
        'skipped', skipped,
        'summary', jsonb_build_object(
            'requested', requested_count,
            'applied', applied_count,
            'skipped', skipped_count
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_findings(target_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_value text;
    actor_email_value text;
    actor_name_value text;
    target_id text;
    requested_count integer := 0;
    applied_count integer := 0;
    skipped_count integer := 0;
    applied jsonb := '[]'::jsonb;
    skipped jsonb := '[]'::jsonb;
    finding_row public.findings%ROWTYPE;
    artifact_count integer := 0;
BEGIN
    SELECT actor, actor_email, actor_name
    INTO actor_value, actor_email_value, actor_name_value
    FROM public.current_actor_identity();

    FOR target_id IN
        SELECT DISTINCT upper(btrim(value))
        FROM unnest(coalesce(target_ids, ARRAY[]::text[])) AS value
        WHERE nullif(btrim(value), '') IS NOT NULL
        ORDER BY 1
    LOOP
        requested_count := requested_count + 1;

        BEGIN
            SELECT *
            INTO finding_row
            FROM public.findings
            WHERE id = target_id;

            IF NOT FOUND THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'not_found',
                        'message', 'Finding not found.'
                    )
                );
                CONTINUE;
            END IF;

            IF NOT public.can_access_record(target_id, 'finding') THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'access_denied',
                        'message', 'You do not have access to this finding.'
                    )
                );
                CONTINUE;
            END IF;

            IF finding_row.supersedes IS NOT NULL AND finding_row.superseded_by IS NOT NULL THEN
                UPDATE public.findings
                SET superseded_by = finding_row.superseded_by
                WHERE id = finding_row.supersedes;

                UPDATE public.findings
                SET supersedes = finding_row.supersedes
                WHERE id = finding_row.superseded_by;
            ELSIF finding_row.supersedes IS NOT NULL THEN
                UPDATE public.findings
                SET superseded_by = NULL,
                    valid_until = NULL
                WHERE id = finding_row.supersedes;
            ELSIF finding_row.superseded_by IS NOT NULL THEN
                UPDATE public.findings
                SET supersedes = NULL
                WHERE id = finding_row.superseded_by;
            END IF;

            WITH deleted_artifacts AS (
                DELETE FROM public.artifacts
                WHERE finding_id = target_id
                RETURNING id
            )
            SELECT count(*)
            INTO artifact_count
            FROM deleted_artifacts;

            DELETE FROM public.findings
            WHERE id = target_id;

            INSERT INTO public.activity_log (
                record_id,
                record_type,
                action,
                actor,
                actor_email,
                actor_name,
                details
            )
            VALUES (
                target_id,
                'finding',
                'deleted',
                actor_value,
                actor_email_value,
                actor_name_value,
                jsonb_build_object(
                    'deleted_by', actor_value,
                    'artifact_count', artifact_count,
                    'supersedes', finding_row.supersedes,
                    'superseded_by', finding_row.superseded_by
                )
            );

            applied_count := applied_count + 1;
            applied := applied || jsonb_build_array(
                jsonb_build_object(
                    'id', target_id,
                    'artifact_count', artifact_count,
                    'supersedes', finding_row.supersedes,
                    'superseded_by', finding_row.superseded_by
                )
            );
        EXCEPTION
            WHEN OTHERS THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'delete_failed',
                        'message', SQLERRM
                    )
                );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'applied', applied,
        'skipped', skipped,
        'summary', jsonb_build_object(
            'requested', requested_count,
            'applied', applied_count,
            'skipped', skipped_count
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_transition_experiments(
    target_ids text[],
    target_status text,
    origin text DEFAULT 'ui_prune'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_value text;
    actor_email_value text;
    actor_name_value text;
    target_id text;
    requested_count integer := 0;
    applied_count integer := 0;
    skipped_count integer := 0;
    applied jsonb := '[]'::jsonb;
    skipped jsonb := '[]'::jsonb;
    experiment_row public.experiments%ROWTYPE;
    resolved_origin text := nullif(btrim(coalesce(origin, '')), '');
BEGIN
    IF target_status NOT IN ('complete', 'failed', 'superseded') THEN
        RAISE EXCEPTION 'Unsupported experiment target status: %', target_status
            USING ERRCODE = '22023';
    END IF;

    IF resolved_origin IS NULL THEN
        resolved_origin := 'ui_prune';
    END IF;

    SELECT actor, actor_email, actor_name
    INTO actor_value, actor_email_value, actor_name_value
    FROM public.current_actor_identity();

    FOR target_id IN
        SELECT DISTINCT upper(btrim(value))
        FROM unnest(coalesce(target_ids, ARRAY[]::text[])) AS value
        WHERE nullif(btrim(value), '') IS NOT NULL
        ORDER BY 1
    LOOP
        requested_count := requested_count + 1;

        BEGIN
            SELECT *
            INTO experiment_row
            FROM public.experiments
            WHERE id = target_id;

            IF NOT FOUND THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'not_found',
                        'message', 'Experiment not found.'
                    )
                );
                CONTINUE;
            END IF;

            IF NOT public.can_access_record(target_id, 'experiment') THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'access_denied',
                        'message', 'You do not have access to this experiment.',
                        'current_status', experiment_row.status
                    )
                );
                CONTINUE;
            END IF;

            IF experiment_row.status = target_status THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'already_target',
                        'message', 'Experiment already has the requested status.',
                        'current_status', experiment_row.status
                    )
                );
                CONTINUE;
            END IF;

            IF target_status IN ('complete', 'failed')
               AND experiment_row.status NOT IN ('open', 'running') THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'ineligible_status',
                        'message', 'Only open or running experiments can be marked complete or failed.',
                        'current_status', experiment_row.status
                    )
                );
                CONTINUE;
            END IF;

            IF target_status = 'superseded'
               AND experiment_row.status NOT IN ('complete', 'failed') THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'ineligible_status',
                        'message', 'Only complete or failed experiments can be archived.',
                        'current_status', experiment_row.status
                    )
                );
                CONTINUE;
            END IF;

            UPDATE public.experiments
            SET status = target_status,
                claimed_by = NULL,
                claimed_at = NULL
            WHERE id = target_id;

            INSERT INTO public.activity_log (
                record_id,
                record_type,
                action,
                actor,
                actor_email,
                actor_name,
                details
            )
            VALUES (
                target_id,
                'experiment',
                'status_changed',
                actor_value,
                actor_email_value,
                actor_name_value,
                jsonb_build_object(
                    'from', experiment_row.status,
                    'to', target_status,
                    'origin', resolved_origin
                )
            );

            applied_count := applied_count + 1;
            applied := applied || jsonb_build_array(
                jsonb_build_object(
                    'id', target_id,
                    'from', experiment_row.status,
                    'to', target_status
                )
            );
        EXCEPTION
            WHEN OTHERS THEN
                skipped_count := skipped_count + 1;
                skipped := skipped || jsonb_build_array(
                    jsonb_build_object(
                        'id', target_id,
                        'reason', 'transition_failed',
                        'message', SQLERRM,
                        'current_status', experiment_row.status
                    )
                );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'applied', applied,
        'skipped', skipped,
        'summary', jsonb_build_object(
            'requested', requested_count,
            'applied', applied_count,
            'skipped', skipped_count
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.current_actor_identity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_delete_questions(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_delete_findings(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_transition_experiments(text[], text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_actor_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete_questions(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete_findings(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_transition_experiments(text[], text, text) TO authenticated;
