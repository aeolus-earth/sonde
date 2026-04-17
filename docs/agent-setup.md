# Giving an Agent Access to Sonde

## 1. Generate a token

An admin creates a scoped token for the agent:

```bash
sonde admin create-token -n "my-agent" -p weather-intervention,shared
```

This prints a `sonde_ak_...` opaque token. **Save it immediately** — it cannot be retrieved later. Older `sonde_bt_...` password-bundle tokens are no longer supported and must be rotated.

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
        "SONDE_TOKEN": "sonde_ak_..."
      }
    }
  }
}
```

### Cursor

Same config in `.cursor/mcp.json`.

### CLI only (no MCP)

```bash
export SONDE_TOKEN="sonde_ak_..."
sonde list          # verify access
sonde brief         # see research state
```

## 3. Verify

```bash
SONDE_TOKEN="sonde_ak_..." sonde whoami
# Should show: agent/my-agent
```

## Token management

```bash
sonde admin list-tokens        # see all tokens + expiry
sonde admin revoke-token <name>  # revoke a token by name
```

Opaque tokens expire after 365 days by default. The CLI exchanges them through the hosted Sonde server for short-lived Supabase sessions, so revocation and expiry are enforced by the `agent_tokens` row instead of by a password embedded in the token.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Not authenticated" | Check `SONDE_TOKEN` is set in the agent's environment |
| "Legacy password-bundle agent tokens" | Rotate the old `sonde_bt_...` token with `sonde admin create-token` |
| "Invalid or expired agent token" | Token may be expired or revoked — create a new one |
| MCP tools not appearing | Check `cwd` points to the `server/` directory with `package.json` |
| "uv not found" | Install [uv](https://docs.astral.sh/uv/) — the MCP server spawns CLI via `uv run sonde` |
| "Permission denied" on programs | Token was scoped to specific programs — create a new token with the right `-p` flag |
