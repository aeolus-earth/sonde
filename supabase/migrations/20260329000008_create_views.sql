-- Useful views for common queries

-- Experiment summary: the greppable table view
CREATE VIEW experiment_summary AS
SELECT
    e.id,
    e.program,
    e.status,
    e.source,
    e.hypothesis,
    e.parameters,
    e.results,
    e.finding,
    e.direction_id,
    e.tags,
    e.created_at,
    e.run_at,
    (SELECT count(*) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count
FROM experiments e
ORDER BY e.created_at DESC;

-- Direction status: experiments, findings, and open questions per direction
CREATE VIEW direction_status AS
SELECT
    d.id,
    d.program,
    d.title,
    d.question,
    d.status,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'running') AS running_count,
    d.created_at,
    d.updated_at
FROM directions d
ORDER BY d.updated_at DESC;

-- Current findings: only those that haven't been superseded
CREATE VIEW current_findings AS
SELECT
    f.id,
    f.program,
    f.topic,
    f.finding,
    f.confidence,
    f.evidence,
    f.source,
    f.valid_from,
    f.supersedes
FROM findings f
WHERE f.valid_until IS NULL
ORDER BY f.valid_from DESC;

-- Research inbox: open questions
CREATE VIEW research_inbox AS
SELECT
    q.id,
    q.program,
    q.question,
    q.context,
    q.source,
    q.raised_by,
    q.tags,
    q.created_at
FROM questions q
WHERE q.status = 'open'
ORDER BY q.created_at DESC;

-- Recent activity: last 50 records across all types
CREATE VIEW recent_activity AS
SELECT id, 'experiment' AS type, program, created_at,
       hypothesis AS summary
FROM experiments
UNION ALL
SELECT id, 'finding' AS type, program, created_at,
       topic || ': ' || finding AS summary
FROM findings
UNION ALL
SELECT id, 'question' AS type, program, created_at,
       question AS summary
FROM questions
ORDER BY created_at DESC
LIMIT 50;
