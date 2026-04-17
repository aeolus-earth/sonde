export const REQUIRED_STAGING_WORKFLOWS = [
  { workflowId: "smoke-staging.yml", name: "Staging Smoke" },
  { workflowId: "deploy-staging.yml", name: "Sync Staging Infra" },
  { workflowId: "config-audit.yml", name: "Config Audit" },
  { workflowId: "cli-hosted-audit.yml", name: "CLI Hosted Audit" },
];

export function hasPromotableTreeDiff(compareData) {
  return (compareData.files ?? []).length > 0;
}

export function isMainAheadOfStaging(compareData) {
  return Number(compareData.ahead_by ?? 0) > 0;
}

export function promotionBody({ stagingSha, successfulRuns = [], state = "ready" }) {
  const lines = [
    "## Summary",
    "",
    "This release PR is managed automatically from the `staging` branch.",
    "",
    `- staging commit: \`${stagingSha}\``,
    "- release method: merge commit",
    "- promotion guard: only `staging -> main` PRs are allowed to pass `merge-readiness`",
    "- human gate: CODEOWNERS approval is required before auto-merge can complete",
  ];

  if (state === "syncing") {
    lines.push(
      "- sync status: staging is being updated with main before promotion can continue",
      "",
      "## Staging gate",
      "",
      "Staging was behind `main`, so this workflow requested a branch update and stopped before enabling auto-merge. Fresh staging checks must pass on the updated commit before this PR can promote.",
    );
    return lines.join("\n");
  }

  lines.push(
    "",
    "## Staging gate",
    "",
    ...successfulRuns.map((run) => `- [${run.name}](${run.html_url})`),
  );
  return lines.join("\n");
}
