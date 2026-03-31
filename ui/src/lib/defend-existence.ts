/**
 * "/defend-my-existence" — expands to a PRD-grounded prompt for the agent.
 * Copy is distilled from prd/overview.md, prd/cli/README.md, and git-replace.md tradeoffs.
 */

export const DEFEND_MY_EXISTENCE_COMMAND = "/defend-my-existence";

const COMMAND_RE = /^\/defend-my-existence\b/i;

const PRODUCT_CONTEXT = `### Sonde / Aeolus CLI — product context (ground truth; cite these ideas)

**What it is:** A structured, queryable research memory for a science org — experiments, findings, directions, questions, artifacts, activity. Not "a notebook" or generic wiki: it enforces schema so agents and humans write the same record types.

**Why not git as the system of record:** We considered git-native tracking (every record a markdown file). Git is brilliant for code provenance — and Sonde still records git_commit / branch on experiments. But the *knowledge base* uses a database because: (1) structured research is the product — \`sonde log\` enforces hypothesis, parameters, tags, program scope; new agent sessions get instant queryability across repos without grepping every file. (2) Concurrent writes — many parallel agents mean git's serialized write model becomes painful; Postgres handles concurrent inserts without push races.

**Why not "just use GitHub issues" or Linear:** Those optimize shipping work items and PRs. Sonde optimizes *scientific* memory — reproducible experiments linked to code/data, findings that supersede each other, directions as research bets, questions as an inbox. Different shape of knowledge.

**Programs (namespaces):** Scoped access — e.g. weather-intervention vs energy-trading vs shared — so agents only see what their mission needs.

**Design principles (from PRD):** One command to log with minimal friction; human and agent records share the same schema; provenance is permanent; the graph stays alive (staleness kills trust).

**Optional:** Local \`sonde pull\` mirrors DB records to \`.sonde/\` markdown for fast agent reads — DB stays authoritative for writes.`;

const TASK_INSTRUCTIONS = `### Your task (UI command: /defend-my-existence)

The user ran this slash command — they may be skeptical, joking, or genuinely asking why this thing exists.

**Tone:** Cheeky, philosophical, Socratic. Ask them questions back. Be confident but not defensive; acknowledge real tradeoffs (e.g. "yes, a well-tended Notion is lovely — but try enforcing EXP- IDs across 16 scientists and six agent runtimes without schema").

**Cover:** Why a purpose-built research memory for AI+human scientists vs ad-hoc tickets/docs/git-only workflows. Reference the database vs git-native and concurrency points when relevant.

**If the user added text after the command**, treat it as their angle, objection, or joke — respond to that specifically.

**Tools:** Prefer *not* to call Sonde MCP tools unless they ask for live experiment data; this turn is mostly conceptual sparring.`;

/**
 * If `raw` is the defend command, returns the full prompt for the agent; otherwise null.
 */
export function expandDefendExistenceCommand(raw: string): string | null {
  const trimmed = raw.trim();
  if (!COMMAND_RE.test(trimmed)) return null;

  const after = trimmed.replace(COMMAND_RE, "").trim();

  const userBit = after
    ? `\n\n### User follow-up (after the command)\n${after}`
    : "";

  return `${PRODUCT_CONTEXT}\n\n${TASK_INSTRUCTIONS}${userBit}`;
}

export function isDefendExistenceCommand(raw: string): boolean {
  return COMMAND_RE.test(raw.trim());
}

/**
 * When the user is typing a prefix of `/defend-my-existence` at the end of the
 * line (with or without a leading `/`), returns the range to replace and an
 * optional inline ghost suffix (only when the token already starts with `/`).
 */
export function getDefendMyExistenceCompletion(
  value: string,
  cursorPos: number
): { start: number; end: number; ghostSuffix: string | null } | null {
  const full = DEFEND_MY_EXISTENCE_COMMAND;
  const fullLower = full.toLowerCase();
  const before = value.slice(0, cursorPos);
  const m = before.match(/(?:^|\s)(\S*)$/);
  if (!m) return null;
  const token = m[1];
  if (!token) return null;
  const start = cursorPos - token.length;

  let norm = token.toLowerCase();
  if (!norm.startsWith("/")) {
    norm = `/${norm}`;
  }
  if (!fullLower.startsWith(norm)) return null;
  if (fullLower.length <= norm.length) return null;

  const ghostSuffix = token.startsWith("/")
    ? full.slice(token.length)
    : null;

  return { start, end: cursorPos, ghostSuffix };
}
