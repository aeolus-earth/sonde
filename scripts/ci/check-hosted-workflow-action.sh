#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

workflows=(
  ".github/workflows/deploy-staging.yml"
  ".github/workflows/deploy.yml"
  ".github/workflows/config-audit.yml"
  ".github/workflows/cli-hosted-audit.yml"
  ".github/workflows/smoke-staging.yml"
  ".github/workflows/smoke-production.yml"
  ".github/workflows/soak-staging.yml"
)

for workflow in "${workflows[@]}"; do
  if ! grep -Eq 'uses:[[:space:]]+\./\.github/actions/load-hosted-env' "$workflow"; then
    echo "::error file=${workflow}::Hosted workflow must use ./.github/actions/load-hosted-env"
    exit 1
  fi
  if ! grep -Eq 'validation-profile:[[:space:]]+[A-Za-z-]+' "$workflow"; then
    echo "::error file=${workflow}::Hosted workflow must set validation-profile on ./.github/actions/load-hosted-env"
    exit 1
  fi
done

if grep -REn 'run:[[:space:]]+node server/scripts/hosted-env-contract\.mjs resolve-github-outputs' .github/workflows >/tmp/hosted-workflow-direct-calls.txt; then
  echo "::error::Hosted workflows should load contract outputs through ./.github/actions/load-hosted-env, not direct resolve-github-outputs calls."
  cat /tmp/hosted-workflow-direct-calls.txt
  exit 1
fi

if grep -REn '\${{\s*(vars|secrets)\.[^}|]+\|\|[[:space:]]*(vars|secrets)\.' "${workflows[@]}" >/tmp/hosted-workflow-fallbacks.txt; then
  echo "::error::Hosted workflows must fail closed and may not chain staging and production vars/secrets together."
  cat /tmp/hosted-workflow-fallbacks.txt
  exit 1
fi

if grep -REn '\${{\s*env\.HOSTED_' "${workflows[@]}" >/tmp/hosted-workflow-env-usage.txt; then
  echo "::error::Hosted workflows must use load-hosted-env outputs and explicit secrets, not raw env.HOSTED_* references."
  cat /tmp/hosted-workflow-env-usage.txt
  exit 1
fi

if grep -REn '^[[:space:]]+HOSTED_[A-Z0-9_]+:' "${workflows[@]}" >/tmp/hosted-workflow-hosted-env-defs.txt; then
  echo "::error::Hosted workflows may not define ad-hoc HOSTED_* env blocks; pass strict inputs to the shared loader action."
  cat /tmp/hosted-workflow-hosted-env-defs.txt
  exit 1
fi

if grep -REn 'MINIMUM_SCHEMA_VERSION' "${workflows[@]}" >/tmp/hosted-workflow-schema-minimum.txt; then
  echo "::error::Hosted workflows must not use the CLI minimum schema as an exact deployed schema. Use server/scripts/resolve-hosted-schema-version.mjs and pass remote_version to runtime parity."
  cat /tmp/hosted-workflow-schema-minimum.txt
  exit 1
fi

if grep -REn 'steps\.schema\.outputs\.version' "${workflows[@]}" >/tmp/hosted-workflow-schema-version-alias.txt; then
  echo "::error::Hosted workflows must use steps.schema.outputs.remote_version for deployed runtime schema parity."
  cat /tmp/hosted-workflow-schema-version-alias.txt
  exit 1
fi

production_audit_workflows=(
  ".github/workflows/config-audit.yml"
  ".github/workflows/cli-hosted-audit.yml"
)

for workflow in "${production_audit_workflows[@]}"; do
  if grep -Eq 'branches:[[:space:]]+\[[^]]*main' "$workflow"; then
    echo "::error file=${workflow}::Production hosted audits must not run directly on main push. Run them after Production Smoke so migrations/deploys finish before schema parity is resolved."
    exit 1
  fi
  if ! grep -Eq 'workflows:[[:space:]]+\["Production Smoke"\]' "$workflow"; then
    echo "::error file=${workflow}::Production hosted audits must be triggered by Production Smoke workflow_run."
    exit 1
  fi
  if ! grep -Eq 'github\.event\.workflow_run\.head_sha[[:space:]]+\|\|[[:space:]]+github\.sha' "$workflow"; then
    echo "::error file=${workflow}::Production hosted audits must use the Production Smoke head SHA when auditing workflow_run events."
    exit 1
  fi
done

ruby <<'RUBY'
require "yaml"

Dir[".github/workflows/*.yml"].sort.each do |workflow|
  data = YAML.load_file(workflow)
  next unless data.is_a?(Hash)

  jobs = data.fetch("jobs", {})
  jobs.each do |job_name, job|
    next unless job.is_a?(Hash)

    Array(job["steps"]).each_with_index do |step, idx|
      next unless step.is_a?(Hash)
      next unless step["uses"]

      if step.key?("working-directory")
        warn "::error file=#{workflow}::job '#{job_name}' step #{idx + 1} uses an action and sets working-directory, which GitHub Actions does not support."
        exit 1
      end
    end
  end
end
RUBY

echo "hosted workflow action usage ok"
