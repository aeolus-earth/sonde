BEGIN;

-- Seeded staging/local dataset for deterministic browser and CLI testing.
-- Keep IDs stable so references, screenshots, and smoke tests stay readable.

-- 1. Clean up prior seed rows so re-running stays idempotent.
DELETE FROM activity_log
WHERE actor = 'seed/staging';

DELETE FROM record_links
WHERE source_id IN (
    'EXP-9001', 'EXP-9002', 'EXP-9003', 'EXP-9004', 'EXP-9005',
    'DIR-9001', 'DIR-9002', 'DIR-9003',
    'FIND-9001', 'FIND-9002',
    'Q-9001', 'Q-9002',
    'PROJ-9001'
)
   OR target_id IN (
    'EXP-9001', 'EXP-9002', 'EXP-9003', 'EXP-9004', 'EXP-9005',
    'DIR-9001', 'DIR-9002', 'DIR-9003',
    'FIND-9001', 'FIND-9002',
    'Q-9001', 'Q-9002',
    'PROJ-9001'
);

DELETE FROM notes
WHERE id IN (
    'NOTE-9001', 'NOTE-9002', 'NOTE-9003', 'NOTE-9004', 'NOTE-9005'
);

DELETE FROM artifacts
WHERE id IN (
    'ART-9001', 'ART-9002', 'ART-9003', 'ART-9004', 'ART-9005', 'ART-9006'
);

DELETE FROM direction_takeaways
WHERE direction_id IN ('DIR-9001', 'DIR-9002', 'DIR-9003');

DELETE FROM project_takeaways
WHERE project_id = 'PROJ-9001';

DELETE FROM program_takeaways
WHERE program = 'shared';

DELETE FROM questions
WHERE id IN ('Q-9001', 'Q-9002');

DELETE FROM findings
WHERE id IN ('FIND-9001', 'FIND-9002');

DELETE FROM experiments
WHERE id IN ('EXP-9001', 'EXP-9002', 'EXP-9003', 'EXP-9004', 'EXP-9005');

DELETE FROM directions
WHERE id IN ('DIR-9001', 'DIR-9002', 'DIR-9003');

DELETE FROM projects
WHERE id = 'PROJ-9001';

-- 2. Main seeded graph.
INSERT INTO projects (
    id, program, name, objective, description, status, source, created_at, updated_at
) VALUES (
    'PROJ-9001',
    'shared',
    'Seeded Staging Baseline',
    'Provide a stable, realistic Sonde workspace for staging and smoke coverage.',
    $md$
# Seeded staging baseline

This project exists so the UI, CLI, and agent server always have a coherent set
of records to render in staging. The goal is not scientific novelty; the goal
is deterministic product verification with enough depth to exercise:

- project, direction, and experiment hierarchy
- active and stale work states
- findings and research questions
- notes, takeaways, timeline metadata, and canvas artifacts
$md$,
    'active',
    'seed/staging',
    '2026-04-01T16:00:00Z',
    '2026-04-07T15:45:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    program = EXCLUDED.program,
    name = EXCLUDED.name,
    objective = EXCLUDED.objective,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO directions (
    id,
    program,
    title,
    question,
    context,
    status,
    source,
    project_id,
    parent_direction_id,
    spawned_from_experiment_id,
    created_at,
    updated_at
) VALUES
(
    'DIR-9001',
    'shared',
    'Marine cloud brightening baseline',
    'How does moderate CCN injection change rainfall response in a maritime convection setup?',
    $md$
We want a direction with enough history to make the timeline, brief, and detail
views interesting. This seeded direction is the main narrative spine for
staging.
$md$,
    'active',
    'seed/staging',
    'PROJ-9001',
    NULL,
    NULL,
    '2026-04-01T17:00:00Z',
    '2026-04-07T15:00:00Z'
),
(
    'DIR-9002',
    'shared',
    'Boundary layer heating interaction',
    'Does boundary layer heating amplify or dampen the CCN response?',
    $md$
This sibling direction carries a failed run so staging can surface unhappy-path
states and recovery prompts.
$md$,
    'active',
    'seed/staging',
    'PROJ-9001',
    NULL,
    NULL,
    '2026-04-02T09:00:00Z',
    '2026-04-06T19:40:00Z'
),
(
    'DIR-9003',
    'shared',
    'Warm-rain refinement',
    'Which warm-rain parameter changes are the next best follow-up from the baseline branch?',
    $md$
Seeded as a child direction to exercise hierarchy and spawned-from context.
$md$,
    'active',
    'seed/staging',
    'PROJ-9001',
    'DIR-9001',
    NULL,
    '2026-04-05T11:00:00Z',
    '2026-04-07T14:10:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    program = EXCLUDED.program,
    title = EXCLUDED.title,
    question = EXCLUDED.question,
    context = EXCLUDED.context,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    project_id = EXCLUDED.project_id,
    parent_direction_id = EXCLUDED.parent_direction_id,
    spawned_from_experiment_id = EXCLUDED.spawned_from_experiment_id,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO experiments (
    id,
    program,
    status,
    source,
    content,
    hypothesis,
    parameters,
    results,
    finding,
    metadata,
    git_commit,
    git_repo,
    git_branch,
    git_close_commit,
    git_close_branch,
    git_dirty,
    code_context,
    data_sources,
    tags,
    direction_id,
    project_id,
    related,
    parent_id,
    branch_type,
    claimed_by,
    claimed_at,
    run_at,
    created_at,
    updated_at
) VALUES
(
    'EXP-9001',
    'shared',
    'complete',
    'seed/staging',
    $md$
# Maritime Cu baseline

Ran the baseline maritime convection setup with moderate CCN loading. The main
takeaway is that rainfall increased modestly without destabilizing the run.
$md$,
    'Moderate CCN injection increases rainfall while preserving convective structure.',
    '{"ccn_cm3": 220, "sst_c": 27, "domain": "maritime-cu", "bl_heating": false}'::jsonb,
    '{"rain_delta_pct": 7.8, "cloud_top_delta_m": 180, "confidence": "medium"}'::jsonb,
    'Baseline run produced a modest rainfall uplift and a small cloud-top increase.',
    '{"seeded": true, "scenario": "baseline"}'::jsonb,
    '0123456789abcdef0123456789abcdef01234567',
    'https://github.com/aeolus-earth/sonde.git',
    'main',
    '0123456789abcdef0123456789abcdef01234567',
    'main',
    false,
    '[{"name":"sonde","remote":"https://github.com/aeolus-earth/sonde.git","commit":"0123456789abcdef0123456789abcdef01234567","branch":"main","dirty":false}]'::jsonb,
    ARRAY['stac://seeded/maritime-cu/baseline'],
    ARRAY['cloud-seeding', 'baseline', 'warm-rain'],
    'DIR-9001',
    'PROJ-9001',
    ARRAY['Q-9001'],
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-04-01T18:00:00Z',
    '2026-04-01T18:30:00Z',
    '2026-04-03T12:00:00Z'
),
(
    'EXP-9002',
    'shared',
    'complete',
    'seed/staging',
    $md$
# Warm-rain follow-up

This refinement branch varied the warm-rain parameterization after the baseline
completed cleanly.
$md$,
    'A warm-rain parameter refinement should preserve uplift while reducing variance.',
    '{"ccn_cm3": 220, "sst_c": 27, "domain": "maritime-cu", "autoconversion_factor": 0.85}'::jsonb,
    '{"rain_delta_pct": 6.1, "variance_delta_pct": -11.0, "confidence": "medium"}'::jsonb,
    'Refinement held most of the uplift and reduced variance.',
    '{"seeded": true, "scenario": "refinement"}'::jsonb,
    '89abcdef0123456789abcdef0123456789abcdef',
    'https://github.com/aeolus-earth/sonde.git',
    'feature/warm-rain-refinement',
    '89abcdef0123456789abcdef0123456789abcdef',
    'feature/warm-rain-refinement',
    false,
    '[{"name":"sonde","remote":"https://github.com/aeolus-earth/sonde.git","commit":"89abcdef0123456789abcdef0123456789abcdef","branch":"feature/warm-rain-refinement","dirty":false}]'::jsonb,
    ARRAY['stac://seeded/maritime-cu/refinement'],
    ARRAY['cloud-seeding', 'refinement', 'warm-rain'],
    'DIR-9001',
    'PROJ-9001',
    ARRAY['EXP-9001'],
    'EXP-9001',
    'refinement',
    NULL,
    NULL,
    '2026-04-03T09:00:00Z',
    '2026-04-03T09:10:00Z',
    '2026-04-05T18:20:00Z'
),
(
    'EXP-9003',
    'shared',
    'running',
    'seed/staging',
    $md$
# Alternative branch in flight

This run is still streaming diagnostics. It keeps the staging home page and
brief page from looking static.
$md$,
    'A slightly higher CCN load might extend the uplift without destabilizing the run.',
    '{"ccn_cm3": 320, "sst_c": 27, "domain": "maritime-cu", "autoconversion_factor": 0.85}'::jsonb,
    '{"progress": 0.62, "latest_rain_delta_pct": 8.9}'::jsonb,
    NULL,
    '{"seeded": true, "scenario": "running"}'::jsonb,
    'fedcba9876543210fedcba9876543210fedcba98',
    'https://github.com/aeolus-earth/sonde.git',
    'feature/ccn-sweep',
    NULL,
    NULL,
    false,
    '[{"name":"sonde","remote":"https://github.com/aeolus-earth/sonde.git","commit":"fedcba9876543210fedcba9876543210fedcba98","branch":"feature/ccn-sweep","dirty":false}]'::jsonb,
    ARRAY['stac://seeded/maritime-cu/running'],
    ARRAY['cloud-seeding', 'running', 'ccn-sweep'],
    'DIR-9001',
    'PROJ-9001',
    ARRAY['EXP-9001', 'EXP-9002'],
    'EXP-9001',
    'alternative',
    'seed-agent',
    '2026-04-07T12:15:00Z',
    '2026-04-07T12:00:00Z',
    '2026-04-07T12:05:00Z',
    '2026-04-07T15:10:00Z'
),
(
    'EXP-9004',
    'shared',
    'failed',
    'seed/staging',
    $md$
# Heating interaction failure

The run diverged after introducing stronger boundary-layer heating. Keeping this
in staging helps us exercise error states and recovery copy.
$md$,
    'Boundary layer heating amplifies the CCN signal without destabilizing the run.',
    '{"ccn_cm3": 250, "sst_c": 27, "domain": "maritime-cu", "bl_heating": true, "heating_w_m2": 35}'::jsonb,
    '{"error": "simulation diverged after 43 minutes", "checkpoint_saved": true}'::jsonb,
    'Diverged before analysis; likely too much heating for this configuration.',
    '{"seeded": true, "scenario": "failed"}'::jsonb,
    '1111111111111111111111111111111111111111',
    'https://github.com/aeolus-earth/sonde.git',
    'feature/bl-heating',
    '1111111111111111111111111111111111111111',
    'feature/bl-heating',
    true,
    '[{"name":"sonde","remote":"https://github.com/aeolus-earth/sonde.git","commit":"1111111111111111111111111111111111111111","branch":"feature/bl-heating","dirty":true,"modified_files":["cases/marine_cu.toml","analysis/heating.py"]}]'::jsonb,
    ARRAY['stac://seeded/maritime-cu/heating'],
    ARRAY['cloud-seeding', 'failed', 'boundary-layer'],
    'DIR-9002',
    'PROJ-9001',
    ARRAY['Q-9002'],
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-04-05T20:20:00Z',
    '2026-04-05T20:00:00Z',
    '2026-04-06T19:40:00Z'
),
(
    'EXP-9005',
    'shared',
    'open',
    'seed/staging',
    $md$
# Queued child-direction follow-up

This experiment has not started yet. It exists so staging always has an obvious
next action in the brief and lineage views.
$md$,
    'A lower autoconversion factor should preserve uplift while improving warm-rain realism.',
    '{"ccn_cm3": 220, "sst_c": 27, "domain": "maritime-cu", "autoconversion_factor": 0.72}'::jsonb,
    NULL,
    NULL,
    '{"seeded": true, "scenario": "open"}'::jsonb,
    '2222222222222222222222222222222222222222',
    'https://github.com/aeolus-earth/sonde.git',
    'feature/warm-rain-followup',
    NULL,
    NULL,
    false,
    '[{"name":"sonde","remote":"https://github.com/aeolus-earth/sonde.git","commit":"2222222222222222222222222222222222222222","branch":"feature/warm-rain-followup","dirty":false}]'::jsonb,
    ARRAY['stac://seeded/maritime-cu/followup'],
    ARRAY['open', 'warm-rain', 'followup'],
    'DIR-9003',
    'PROJ-9001',
    ARRAY['EXP-9002'],
    'EXP-9002',
    'refinement',
    NULL,
    NULL,
    NULL,
    '2026-04-06T08:00:00Z',
    '2026-04-07T08:30:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    program = EXCLUDED.program,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    content = EXCLUDED.content,
    hypothesis = EXCLUDED.hypothesis,
    parameters = EXCLUDED.parameters,
    results = EXCLUDED.results,
    finding = EXCLUDED.finding,
    metadata = EXCLUDED.metadata,
    git_commit = EXCLUDED.git_commit,
    git_repo = EXCLUDED.git_repo,
    git_branch = EXCLUDED.git_branch,
    git_close_commit = EXCLUDED.git_close_commit,
    git_close_branch = EXCLUDED.git_close_branch,
    git_dirty = EXCLUDED.git_dirty,
    code_context = EXCLUDED.code_context,
    data_sources = EXCLUDED.data_sources,
    tags = EXCLUDED.tags,
    direction_id = EXCLUDED.direction_id,
    project_id = EXCLUDED.project_id,
    related = EXCLUDED.related,
    parent_id = EXCLUDED.parent_id,
    branch_type = EXCLUDED.branch_type,
    claimed_by = EXCLUDED.claimed_by,
    claimed_at = EXCLUDED.claimed_at,
    run_at = EXCLUDED.run_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

UPDATE directions
SET spawned_from_experiment_id = 'EXP-9002'
WHERE id = 'DIR-9003';

INSERT INTO findings (
    id,
    program,
    topic,
    finding,
    confidence,
    content,
    metadata,
    evidence,
    source,
    valid_from,
    valid_until,
    supersedes,
    superseded_by,
    created_at,
    updated_at
) VALUES
(
    'FIND-9001',
    'shared',
    'Baseline rainfall response',
    'Mid-range CCN loading produced a repeatable rainfall uplift without destabilizing the seeded maritime-cu setup.',
    'medium',
    $md$
The seeded baseline is intentionally conservative: enough structure to look
real, but stable enough for repeated testing.
$md$,
    '{"seeded": true, "category": "baseline"}'::jsonb,
    ARRAY['EXP-9001', 'EXP-9002'],
    'seed/staging',
    '2026-04-03T12:30:00Z',
    NULL,
    NULL,
    NULL,
    '2026-04-03T12:30:00Z',
    '2026-04-05T18:30:00Z'
),
(
    'FIND-9002',
    'shared',
    'Boundary layer heating instability',
    'The stronger boundary-layer heating variant diverged before analysis, suggesting the seeded configuration exceeds the stable operating envelope.',
    'low',
    $md$
This finding stays current so failure states appear in staging instead of being
filtered out.
$md$,
    '{"seeded": true, "category": "failure"}'::jsonb,
    ARRAY['EXP-9004'],
    'seed/staging',
    '2026-04-06T19:45:00Z',
    NULL,
    NULL,
    NULL,
    '2026-04-06T19:45:00Z',
    '2026-04-06T19:45:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    program = EXCLUDED.program,
    topic = EXCLUDED.topic,
    finding = EXCLUDED.finding,
    confidence = EXCLUDED.confidence,
    content = EXCLUDED.content,
    metadata = EXCLUDED.metadata,
    evidence = EXCLUDED.evidence,
    source = EXCLUDED.source,
    valid_from = EXCLUDED.valid_from,
    valid_until = EXCLUDED.valid_until,
    supersedes = EXCLUDED.supersedes,
    superseded_by = EXCLUDED.superseded_by,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO questions (
    id,
    program,
    question,
    context,
    content,
    metadata,
    status,
    source,
    raised_by,
    promoted_to_type,
    promoted_to_id,
    tags,
    created_at,
    updated_at
) VALUES
(
    'Q-9001',
    'shared',
    'Where does the CCN uplift stop being worth the additional variance?',
    'Open follow-up after the baseline and refinement pair.',
    $md$
Potential follow-up for the running branch if the 320 cm^-3 case holds.
$md$,
    '{"seeded": true, "priority": "medium"}'::jsonb,
    'open',
    'seed/staging',
    'infrastructure@aeolus.earth',
    NULL,
    NULL,
    ARRAY['ccn', 'follow-up'],
    '2026-04-05T09:00:00Z',
    '2026-04-05T09:00:00Z'
),
(
    'Q-9002',
    'shared',
    'Can we stabilize the heating experiment by lowering the forcing window?',
    'Recovery path after the diverged heating experiment.',
    $md$
This question exists so staging shows both open research and failure recovery.
$md$,
    '{"seeded": true, "priority": "high"}'::jsonb,
    'investigating',
    'seed/staging',
    'infrastructure@aeolus.earth',
    NULL,
    NULL,
    ARRAY['boundary-layer', 'recovery'],
    '2026-04-06T20:10:00Z',
    '2026-04-06T20:10:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    program = EXCLUDED.program,
    question = EXCLUDED.question,
    context = EXCLUDED.context,
    content = EXCLUDED.content,
    metadata = EXCLUDED.metadata,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    raised_by = EXCLUDED.raised_by,
    promoted_to_type = EXCLUDED.promoted_to_type,
    promoted_to_id = EXCLUDED.promoted_to_id,
    tags = EXCLUDED.tags,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

-- 3. Ancillary data used across detail and brief views.
INSERT INTO program_takeaways (program, body, updated_at) VALUES (
    'shared',
    $md$
- The seeded baseline is healthy and intentionally repeatable.
- There is one running branch, one queued follow-up, and one failed branch.
- Use this project to verify staging behavior before shipping user-facing changes.
$md$,
    '2026-04-07T15:30:00Z'
)
ON CONFLICT (program) DO UPDATE
SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

INSERT INTO project_takeaways (project_id, body, updated_at) VALUES (
    'PROJ-9001',
    $md$
- Baseline and refinement runs both complete cleanly.
- The heating variant is the current failure case.
- The open follow-up under `DIR-9003` is the obvious next execution target.
$md$,
    '2026-04-07T15:32:00Z'
)
ON CONFLICT (project_id) DO UPDATE
SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

INSERT INTO direction_takeaways (direction_id, body, updated_at) VALUES
(
    'DIR-9001',
    $md$
- Baseline uplift is repeatable.
- The 320 cm^-3 branch is still running and should determine whether uplift saturates.
$md$,
    '2026-04-07T15:33:00Z'
),
(
    'DIR-9002',
    $md$
- Heating case diverged.
- The main question is whether a shorter forcing window restores stability.
$md$,
    '2026-04-06T20:20:00Z'
),
(
    'DIR-9003',
    $md$
- Child direction exists to exercise hierarchy and queued follow-on work.
- `EXP-9005` should be the next run if the baseline remains stable.
$md$,
    '2026-04-07T15:34:00Z'
)
ON CONFLICT (direction_id) DO UPDATE
SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

INSERT INTO notes (
    id, record_type, record_id, content, source, created_at, updated_at
) VALUES
(
    'NOTE-9001',
    'project',
    'PROJ-9001',
    'Staging note: this project should always remain safe to reseed and easy to demo.',
    'seed/staging',
    '2026-04-07T15:35:00Z',
    '2026-04-07T15:35:00Z'
),
(
    'NOTE-9002',
    'direction',
    'DIR-9001',
    'Compare `EXP-9003` against both the baseline and the refinement branch before calling the sweep done.',
    'seed/staging',
    '2026-04-07T15:36:00Z',
    '2026-04-07T15:36:00Z'
),
(
    'NOTE-9003',
    'direction',
    'DIR-9002',
    'Recovery path for the heating case: lower forcing duration before changing CCN again.',
    'seed/staging',
    '2026-04-06T20:15:00Z',
    '2026-04-06T20:15:00Z'
),
(
    'NOTE-9004',
    'experiment',
    'EXP-9003',
    'Streaming branch intentionally remains claimed so staging always has active work in progress.',
    'seed/staging',
    '2026-04-07T12:20:00Z',
    '2026-04-07T12:20:00Z'
),
(
    'NOTE-9005',
    'experiment',
    'EXP-9005',
    'Queued follow-up stays open to exercise stale/open prompts in the brief view.',
    'seed/staging',
    '2026-04-07T08:35:00Z',
    '2026-04-07T08:35:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    record_type = EXCLUDED.record_type,
    record_id = EXCLUDED.record_id,
    content = EXCLUDED.content,
    source = EXCLUDED.source,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO record_links (
    source_id, source_type, target_id, target_type, label, created_at
) VALUES
    ('Q-9001', 'question', 'EXP-9003', 'experiment', 'follow-up run', '2026-04-07T12:10:00Z'),
    ('EXP-9002', 'experiment', 'DIR-9003', 'direction', 'spawned child direction', '2026-04-05T11:00:00Z'),
    ('FIND-9001', 'finding', 'EXP-9001', 'experiment', 'evidence', '2026-04-03T12:30:00Z'),
    ('FIND-9002', 'finding', 'EXP-9004', 'experiment', 'evidence', '2026-04-06T19:45:00Z')
ON CONFLICT (source_id, target_id) DO UPDATE
SET label = EXCLUDED.label, created_at = EXCLUDED.created_at;

INSERT INTO artifacts (
    id,
    filename,
    type,
    mime_type,
    size_bytes,
    description,
    checksum_sha256,
    storage_path,
    experiment_id,
    finding_id,
    direction_id,
    project_id,
    source,
    created_at
) VALUES
(
    'ART-9001',
    'baseline-summary.md',
    'report',
    'text/markdown',
    1824,
    'Narrative summary for the baseline seeded run.',
    '4a0f0a6ecb4d4d4b7169248f047cc83f49b4f3348be5d4fceab47a7fe90db001',
    'EXP-9001/baseline-summary.md',
    'EXP-9001',
    NULL,
    NULL,
    NULL,
    'seed/staging',
    '2026-04-03T12:05:00Z'
),
(
    'ART-9002',
    'loss_curve.csv',
    'dataset',
    'text/csv',
    842,
    'Seeded CSV artifact for timeline and canvas coverage.',
    '8d2f1c8f3079d9e8ca6f0f0adfb81714cb514668df8e8f390adf52f1f2dc9002',
    'EXP-9003/loss_curve.csv',
    'EXP-9003',
    NULL,
    NULL,
    NULL,
    'seed/staging',
    '2026-04-07T12:12:00Z'
),
(
    'ART-9003',
    'heating-debug.log',
    'log',
    'text/plain',
    2401,
    'Failure log for the diverged boundary-layer run.',
    '9c2f3198f48dce4a7b8c0d773fd7fb104d33baae8f5a7b8eab0d40cfd1aa9003',
    'EXP-9004/heating-debug.log',
    'EXP-9004',
    NULL,
    NULL,
    NULL,
    'seed/staging',
    '2026-04-06T19:41:00Z'
),
(
    'ART-9004',
    'warm-rain-scope.md',
    'notebook',
    'text/markdown',
    1299,
    'Direction note captured as a seeded artifact.',
    '0d7abca13441f7cc27f45f6b9f19a8d7a48ed73c4f9979d7b3d0bd67fb109004',
    'DIR-9003/warm-rain-scope.md',
    NULL,
    NULL,
    'DIR-9003',
    NULL,
    'seed/staging',
    '2026-04-07T14:12:00Z'
),
(
    'ART-9005',
    'project-brief.pdf',
    'report',
    'application/pdf',
    98123,
    'Direction-level seeded brief artifact.',
    '7c29195fa08b7277a14e5362ca08d8fb6d1e14fca0de3296a119875cb8de9005',
    'DIR-9001/project-brief.pdf',
    NULL,
    NULL,
    'DIR-9001',
    NULL,
    'seed/staging',
    '2026-04-07T15:20:00Z'
),
(
    'ART-9006',
    'ccn-panel.png',
    'figure',
    'image/png',
    55432,
    'Seeded figure placeholder for the canvas.',
    '56f47599a8a0d17fd8b5d792efe2caa9d64884820f7a07b61e6494c4fd749006',
    'EXP-9002/ccn-panel.png',
    'EXP-9002',
    NULL,
    NULL,
    NULL,
    'seed/staging',
    '2026-04-05T18:15:00Z'
)
ON CONFLICT (id) DO UPDATE
SET
    filename = EXCLUDED.filename,
    type = EXCLUDED.type,
    mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes,
    description = EXCLUDED.description,
    checksum_sha256 = EXCLUDED.checksum_sha256,
    storage_path = EXCLUDED.storage_path,
    experiment_id = EXCLUDED.experiment_id,
    finding_id = EXCLUDED.finding_id,
    direction_id = EXCLUDED.direction_id,
    project_id = EXCLUDED.project_id,
    source = EXCLUDED.source,
    created_at = EXCLUDED.created_at;

INSERT INTO activity_log (
    record_id, record_type, action, actor, actor_email, actor_name, details, created_at
) VALUES
    ('PROJ-9001', 'project', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"source":"seed"}', '2026-04-01T16:00:00Z'),
    ('DIR-9001', 'direction', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"source":"seed"}', '2026-04-01T17:00:00Z'),
    ('DIR-9002', 'direction', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"source":"seed"}', '2026-04-02T09:00:00Z'),
    ('EXP-9001', 'experiment', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"complete"}', '2026-04-01T18:30:00Z'),
    ('EXP-9002', 'experiment', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"complete"}', '2026-04-03T09:10:00Z'),
    ('EXP-9003', 'experiment', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"running"}', '2026-04-07T12:05:00Z'),
    ('EXP-9004', 'experiment', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"failed"}', '2026-04-05T20:00:00Z'),
    ('EXP-9005', 'experiment', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"open"}', '2026-04-06T08:00:00Z'),
    ('FIND-9001', 'finding', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"confidence":"medium"}', '2026-04-03T12:30:00Z'),
    ('Q-9002', 'question', 'created', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"status":"investigating"}', '2026-04-06T20:10:00Z'),
    ('EXP-9003', 'experiment', 'note_added', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"note_id":"NOTE-9004"}', '2026-04-07T12:20:00Z'),
    ('EXP-9003', 'experiment', 'artifact_attached', 'seed/staging', 'infrastructure@aeolus.earth', 'Seeded Staging', '{"artifact_id":"ART-9002"}', '2026-04-07T12:12:00Z')
ON CONFLICT DO NOTHING;

-- 4. Staging/local admin auto-grant.
CREATE OR REPLACE FUNCTION public.seed_assign_staging_admin_programs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.email = 'infrastructure@aeolus.earth' THEN
        INSERT INTO public.user_programs (user_id, program, role)
        VALUES
            (NEW.id, 'shared', 'admin'),
            (NEW.id, 'weather-intervention', 'admin'),
            (NEW.id, 'nwp-development', 'admin')
        ON CONFLICT (user_id, program) DO UPDATE
        SET role = EXCLUDED.role;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_assign_staging_admin_programs ON auth.users;
CREATE TRIGGER seed_assign_staging_admin_programs
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.seed_assign_staging_admin_programs();

INSERT INTO public.user_programs (user_id, program, role)
SELECT u.id, grant_row.program, 'admin'
FROM auth.users u
CROSS JOIN (
    VALUES ('shared'), ('weather-intervention'), ('nwp-development')
) AS grant_row(program)
WHERE u.email = 'infrastructure@aeolus.earth'
ON CONFLICT (user_id, program) DO UPDATE
SET role = EXCLUDED.role;

COMMIT;
