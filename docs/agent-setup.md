# Giving an Agent Access to Sonde

## 1. Generate a token

An admin creates a scoped token for the agent:

```bash
sonde admin create-token -n "my-agent" -p weather-intervention,shared
```

This prints a `sonde_bt_...` token. **Save it immediately** — it cannot be retrieved later.

Options:
- `-n` — agent name (used in activity logs as `agent/my-agent`)
- `-p` — comma-separated programs the agent can access
- `--expires 90` — custom expiry in days (default: 365)

## 2. Configure the agent

### Claude Code

Run `sonde setup` inside the repo — it auto-configures `.claude/settings.json`.

Or add manually:

```json
{
  "mcpServers": {
    "sonde": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/sonde/server",
      "env": {
        "SONDE_TOKEN": "sonde_bt_..."
      }
    }
  }
}
```

### Cursor

Same config in `.cursor/mcp.json`.

### CLI only (no MCP)

```bash
export SONDE_TOKEN="sonde_bt_..."
sonde list          # verify access
sonde brief         # see research state
```

## 3. Verify

```bash
SONDE_TOKEN="sonde_bt_..." sonde whoami
# Should show: agent/my-agent
```

## Token management

```bash
sonde admin list-tokens        # see all tokens + expiry
sonde admin revoke-token <id>  # revoke a token
```

Tokens expire after 365 days by default. Create a new one when expired.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Not authenticated" | Check `SONDE_TOKEN` is set in the agent's environment |
| "Bot token authentication failed" | Token may be expired — create a new one |
| MCP tools not appearing | Check `cwd` points to the `server/` directory with `package.json` |
| "uv not found" | Install [uv](https://docs.astral.sh/uv/) — the MCP server spawns CLI via `uv run sonde` |
| "Permission denied" on programs | Token was scoped to specific programs — create a new token with the right `-p` flag |
