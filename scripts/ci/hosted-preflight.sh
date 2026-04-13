#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

log_section() {
  printf '\n==> %s\n' "$1"
}

normalize_http_base() {
  node -e 'const raw = process.argv[1]; const url = new URL(raw); console.log(`${url.origin}${url.pathname.replace(/\/$/, "")}`);' "$1"
}

resolve_agent_http_base() {
  if [[ -n "${SONDE_HOSTED_PREFLIGHT_AGENT_HTTP_BASE:-}" ]]; then
    printf '%s\n' "$SONDE_HOSTED_PREFLIGHT_AGENT_HTTP_BASE"
    return 0
  fi

  if [[ -n "${VITE_AGENT_HTTP_BASE:-}" ]]; then
    printf '%s\n' "$VITE_AGENT_HTTP_BASE"
    return 0
  fi

  if [[ -n "${VITE_AGENT_WS_URL:-}" ]]; then
    node -e 'const raw = process.argv[1]; const url = new URL(raw); url.protocol = url.protocol === "wss:" ? "https:" : "http:"; console.log(`${url.origin}${url.pathname.replace(/\/$/, "")}`);' "$VITE_AGENT_WS_URL"
    return 0
  fi

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh variable get SONDE_STAGING_AGENT_HTTP_BASE 2>/dev/null || true
    return 0
  fi

  printf '\n'
}

resolve_app_origin() {
  if [[ -n "${SONDE_HOSTED_PREFLIGHT_APP_ORIGIN:-}" ]]; then
    printf '%s\n' "$SONDE_HOSTED_PREFLIGHT_APP_ORIGIN"
    return 0
  fi

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh variable get SONDE_STAGING_UI_URL 2>/dev/null || true
    return 0
  fi

  printf 'https://sonde-staging.vercel.app\n'
}

agent_http_base="$(resolve_agent_http_base | tr -d '\r')"
app_origin="$(resolve_app_origin | tr -d '\r')"

if [[ -z "$agent_http_base" ]]; then
  if [[ "${SONDE_HOSTED_PREFLIGHT_REQUIRED:-0}" == "1" || -n "${CI:-}" ]]; then
    echo "::error::Unable to resolve an agent base for hosted preflight. Set SONDE_HOSTED_PREFLIGHT_AGENT_HTTP_BASE or authenticate gh so the script can read SONDE_STAGING_AGENT_HTTP_BASE."
    exit 1
  fi
  echo "Skipping hosted preflight locally because no hosted agent base could be resolved. Set SONDE_HOSTED_PREFLIGHT_AGENT_HTTP_BASE to enable it."
  exit 0
fi

agent_http_base="$(normalize_http_base "$agent_http_base")"
agent_ws_base="$(node -e 'const raw = process.argv[1]; const url = new URL(raw); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; console.log(`${url.origin}${url.pathname.replace(/\/$/, "")}`);' "$agent_http_base")"
agent_http_origin="$(node -e 'console.log(new URL(process.argv[1]).origin)' "$agent_http_base")"
agent_ws_origin="$(node -e 'console.log(new URL(process.argv[1]).origin)' "$agent_ws_base")"

log_section "Building UI with hosted agent configuration"
(
  cd ui
  rm -rf dist
  VITE_AGENT_WS_URL="$agent_ws_base" \
  VITE_PUBLIC_APP_ORIGIN="$app_origin" \
  SONDE_ENVIRONMENT=staging \
  npm run build
)

log_section "Validating version metadata"
node - "$ROOT/ui/dist/version.json" "$agent_http_origin" <<'NODE'
const fs = require("node:fs");

const versionPath = process.argv[2];
const expectedOrigin = process.argv[3];
const body = JSON.parse(fs.readFileSync(versionPath, "utf8"));

if (!Object.prototype.hasOwnProperty.call(body, "agentWsConfigured")) {
  throw new Error("version.json is missing agentWsConfigured");
}
if (!Object.prototype.hasOwnProperty.call(body, "agentWsOrigin")) {
  throw new Error("version.json is missing agentWsOrigin");
}
if (!body.agentWsConfigured) {
  throw new Error("version.json reported agentWsConfigured=false");
}
if ((body.agentWsOrigin ?? null) !== expectedOrigin) {
  throw new Error(
    `version.json agentWsOrigin mismatch: expected ${expectedOrigin}, got ${body.agentWsOrigin}`
  );
}
console.log("version metadata ok");
NODE

log_section "Validating generated Vercel CSP"
root_config_json="$(
  cd server
  VITE_AGENT_WS_URL="$agent_ws_base" npx tsx ../scripts/ci/read-vercel-config.ts ../vercel.ts
)"
ui_config_json="$(
  cd server
  VITE_AGENT_WS_URL="$agent_ws_base" npx tsx ../scripts/ci/read-vercel-config.ts ../ui/vercel.ts
)"

node - "$root_config_json" "$ui_config_json" "$agent_http_origin" "$agent_ws_origin" <<'NODE'
function cspHeader(config) {
  for (const rule of config.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if ((header.key ?? "").toLowerCase() === "content-security-policy") {
        return header.value ?? "";
      }
    }
  }
  return "";
}

const [rootJson, uiJson, expectedHttpOrigin, expectedWsOrigin] = process.argv.slice(2);
for (const [name, json] of [
  ["root", rootJson],
  ["ui", uiJson],
]) {
  const config = JSON.parse(json);
  const csp = cspHeader(config);
  if (!csp.includes("connect-src")) {
    throw new Error(`${name} vercel config is missing connect-src CSP`);
  }
  if (!csp.includes(expectedHttpOrigin)) {
    throw new Error(`${name} vercel config is missing ${expectedHttpOrigin} in connect-src`);
  }
  if (!csp.includes(expectedWsOrigin)) {
    throw new Error(`${name} vercel config is missing ${expectedWsOrigin} in connect-src`);
  }
}
console.log("vercel config CSP ok");
NODE
