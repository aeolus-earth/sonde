#!/usr/bin/env bash
# Scan the working tree for accidentally-committed secrets.
# Run from repo root. Reports any hits to stdout; exits 1 if any found.
#
#   bash scripts/security/secrets-grep.sh

set -u
cd "$(git rev-parse --show-toplevel)"

hits=0

scan() {
    local label="$1"
    local pattern="$2"
    local matches
    # -I skip binary, --exclude-standard honors .gitignore, -E for regex
    matches=$(git grep -EIn "$pattern" -- . ':!*.lock' ':!package-lock.json' ':!uv.lock' 2>/dev/null || true)
    if [ -n "$matches" ]; then
        printf '\n=== %s ===\n%s\n' "$label" "$matches"
        hits=$((hits + 1))
    fi
}

scan "PRIVATE KEY blocks" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
scan "AWS access keys"    'AKIA[0-9A-Z]{16}'
scan "GitHub tokens"      'gh[pousr]_[A-Za-z0-9_]{36,}'
scan "Slack tokens"       'xox[baprs]-[A-Za-z0-9-]{10,}'
scan "Stripe live secrets"   'sk_live_[A-Za-z0-9]{24,}'
scan "Supabase service role" 'service_role[ :=\"\''][ ]*eyJ'
scan "JWT tokens (eyJ)"   'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'
scan "Generic API keys with prefix sk_" 'sk_[A-Za-z0-9]{20,}'

echo
echo "=== .env files tracked by git (excluding .env.example) ==="
tracked_env=$(
    git ls-files \
        | grep -E '(^|/)([^/]*\.env($|\.)|example\.env$)' \
        | grep -Ev '(^|/)(\.env\.example|example\.env)$' \
        || true
)
if [ -n "$tracked_env" ]; then
    printf '%s\n' "$tracked_env"
    hits=$((hits + 1))
fi

echo
if [ "$hits" -gt 0 ]; then
    echo "FAIL: $hits pattern(s) matched. Investigate each hit."
    exit 1
fi
echo "OK: no secrets matched."
