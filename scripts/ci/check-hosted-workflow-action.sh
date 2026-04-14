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
  if ! rg -q 'uses:\s+\./\.github/actions/load-hosted-env' "$workflow"; then
    echo "::error file=${workflow}::Hosted workflow must use ./.github/actions/load-hosted-env"
    exit 1
  fi
done

if rg -n 'run:\s+node server/scripts/hosted-env-contract\.mjs resolve-github-outputs' .github/workflows \
  | grep -v '^$' >/dev/null; then
  echo "::error::Hosted workflows should load contract outputs through ./.github/actions/load-hosted-env, not direct resolve-github-outputs calls."
  rg -n 'run:\s+node server/scripts/hosted-env-contract\.mjs resolve-github-outputs' .github/workflows
  exit 1
fi

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
