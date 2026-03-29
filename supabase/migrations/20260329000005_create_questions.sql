-- Questions: the research inbox
-- Lightweight ideas captured from Slack, conversations, agent suggestions
-- Can be promoted to experiments or directions

CREATE TABLE questions (
    id TEXT PRIMARY KEY,  -- Q-001 format
    program TEXT NOT NULL REFERENCES programs(id),
    question TEXT NOT NULL,
    context TEXT,  -- where this came from, why it matters
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'investigating', 'promoted', 'dismissed')),

    source TEXT NOT NULL,       -- slack-bot/channel-research, human/mlee, codex/...
    raised_by TEXT,             -- human who originally asked (if known)

    -- Promotion tracking
    promoted_to_type TEXT CHECK (promoted_to_type IN ('experiment', 'direction')),
    promoted_to_id TEXT,        -- EXP-xxxx or DIR-xxxx

    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_program ON questions (program);
CREATE INDEX idx_questions_status ON questions (status);
CREATE INDEX idx_questions_tags ON questions USING GIN (tags);
CREATE INDEX idx_questions_fts ON questions USING GIN (
    to_tsvector('english', question || ' ' || coalesce(context, ''))
);

CREATE TRIGGER questions_updated_at
    BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE SEQUENCE question_id_seq START 1;
