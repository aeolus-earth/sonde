#!/usr/bin/env node

import { appendFileSync } from "node:fs";

export const REQUIRED_WORKFLOWS = [
  {
    label: "Production Smoke",
    workflowId: "smoke-production.yml",
    branch: "main",
    event: "push",
  },
  {
    label: "Sync Production Infra",
    workflowId: "deploy.yml",
    branch: "main",
    event: "push",
  },
  {
    label: "Config Audit",
    workflowId: "config-audit.yml",
    branch: "main",
    event: "workflow_run",
  },
  {
    label: "CLI Hosted Audit",
    workflowId: "cli-hosted-audit.yml",
    branch: "main",
    event: "workflow_run",
  },
  {
    label: "CI",
    workflowId: "ci.yml",
    branch: "main",
    event: "push",
  },
  {
    label: "Tag on Promote",
    workflowId: "tag-on-promote.yml",
    branch: "main",
    event: "push",
  },
  {
    label: "Release",
    workflowId: "release.yml",
    event: "push",
  },
];

export const REQUIRED_STATUS_CONTEXTS = [
  {
    label: "Vercel Production",
    context: "Vercel \u2013 sonde",
  },
];

export const REQUIRED_CHECK_GROUPS = [
  {
    label: "CodeQL",
    prefix: "Analyze (",
  },
];

const SUCCESS_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseRepository(repository) {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got: ${repository}`);
  }
  return { owner, repo };
}

function endpoint(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

export function createGitHubClient({ token, apiUrl = "https://api.github.com" }) {
  return {
    async request(path) {
      const response = await fetch(`${apiUrl}${endpoint(path)}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API ${response.status} for ${path}: ${body}`);
      }

      return response.json();
    },
  };
}

export function itemStateFromWorkflowRun(run) {
  if (!run) {
    return {
      status: "missing",
      details: "No run found for the target SHA.",
    };
  }

  if (run.status !== "completed") {
    return {
      status: "pending",
      details: `status=${run.status}`,
      url: run.html_url,
    };
  }

  if (!SUCCESS_CONCLUSIONS.has(run.conclusion)) {
    return {
      status: "failure",
      details: `conclusion=${run.conclusion ?? "unknown"}`,
      url: run.html_url,
    };
  }

  return {
    status: "success",
    details: `conclusion=${run.conclusion}`,
    url: run.html_url,
  };
}

export function itemStateFromCommitStatus(status) {
  if (!status) {
    return {
      status: "missing",
      details: "No commit status found for the target SHA.",
    };
  }

  if (status.state === "pending") {
    return {
      status: "pending",
      details: "state=pending",
      url: status.target_url,
    };
  }

  if (status.state !== "success") {
    return {
      status: "failure",
      details: `state=${status.state}`,
      url: status.target_url,
    };
  }

  return {
    status: "success",
    details: "state=success",
    url: status.target_url,
  };
}

export function itemStateFromCheckGroup(checkRuns, group) {
  const runs = checkRuns.filter((run) => run.name.startsWith(group.prefix));
  if (runs.length === 0) {
    return {
      status: "missing",
      details: `No check runs matched ${group.prefix}`,
    };
  }

  const pending = runs.find((run) => run.status !== "completed");
  if (pending) {
    return {
      status: "pending",
      details: `${pending.name} status=${pending.status}`,
      url: pending.html_url,
    };
  }

  const failed = runs.find((run) => !SUCCESS_CONCLUSIONS.has(run.conclusion));
  if (failed) {
    return {
      status: "failure",
      details: `${failed.name} conclusion=${failed.conclusion ?? "unknown"}`,
      url: failed.html_url,
    };
  }

  return {
    status: "success",
    details: runs.map((run) => `${run.name}=success`).join(", "),
    url: runs[0].html_url,
  };
}

export function itemStateFromReleaseTag({ release, tagSha, targetSha }) {
  if (!release) {
    return {
      status: "missing",
      details: "No latest release found.",
    };
  }

  if (!tagSha) {
    return {
      status: "missing",
      details: `Could not resolve ${release.tag_name} to a commit.`,
      url: release.html_url,
    };
  }

  if (tagSha !== targetSha) {
    return {
      status: "pending",
      details: `${release.tag_name} points to ${tagSha}`,
      url: release.html_url,
    };
  }

  return {
    status: "success",
    details: `${release.tag_name} points to target SHA`,
    url: release.html_url,
  };
}

export function summarizeHealth(items, { final = false } = {}) {
  const failures = [];
  const pending = [];

  for (const item of items) {
    if (item.status === "failure") {
      failures.push(item);
    } else if (item.status === "pending" || item.status === "missing") {
      pending.push(item);
    }
  }

  if (failures.length > 0 || (final && pending.length > 0)) {
    return {
      status: "failure",
      failures: [...failures, ...(final ? pending : [])],
      pending: final ? [] : pending,
    };
  }

  if (pending.length > 0) {
    return {
      status: "pending",
      failures,
      pending,
    };
  }

  return {
    status: "success",
    failures,
    pending,
  };
}

export function renderSummary({ targetSha, items, summary }) {
  const rows = items
    .map((item) => {
      const url = item.url ? `[open](${item.url})` : "";
      return `| ${item.label} | ${item.status} | ${item.details.replaceAll("|", "\\|")} | ${url} |`;
    })
    .join("\n");

  return [
    "# Release Health",
    "",
    `Target SHA: \`${targetSha}\``,
    "",
    `Overall status: **${summary.status}**`,
    "",
    "| Check | Status | Details | Link |",
    "| --- | --- | --- | --- |",
    rows,
    "",
  ].join("\n");
}

async function findWorkflowRun(github, { owner, repo, targetSha, spec }) {
  const params = new URLSearchParams({ per_page: "50" });
  if (spec.branch) {
    params.set("branch", spec.branch);
  }

  const data = await github.request(
    `/repos/${owner}/${repo}/actions/workflows/${spec.workflowId}/runs?${params}`,
  );
  const runs = data?.workflow_runs ?? [];
  return runs.find(
    (run) => run.head_sha === targetSha && (!spec.event || run.event === spec.event),
  );
}

async function collectWorkflowItems(github, { owner, repo, targetSha }) {
  const items = [];
  for (const spec of REQUIRED_WORKFLOWS) {
    const run = await findWorkflowRun(github, {
      owner,
      repo,
      targetSha,
      spec,
    });
    items.push({
      label: spec.label,
      kind: "workflow",
      ...itemStateFromWorkflowRun(run),
    });
  }
  return items;
}

async function collectStatusItems(github, { owner, repo, targetSha }) {
  const combined = await github.request(`/repos/${owner}/${repo}/commits/${targetSha}/status`);
  const statuses = combined?.statuses ?? [];
  return REQUIRED_STATUS_CONTEXTS.map((spec) => ({
    label: spec.label,
    kind: "status",
    ...itemStateFromCommitStatus(statuses.find((status) => status.context === spec.context)),
  }));
}

async function collectCheckItems(github, { owner, repo, targetSha }) {
  const data = await github.request(
    `/repos/${owner}/${repo}/commits/${targetSha}/check-runs?per_page=100`,
  );
  const checkRuns = data?.check_runs ?? [];
  return REQUIRED_CHECK_GROUPS.map((group) => ({
    label: group.label,
    kind: "check_group",
    ...itemStateFromCheckGroup(checkRuns, group),
  }));
}

async function resolveTagSha(github, { owner, repo, tagName }) {
  const ref = await github.request(`/repos/${owner}/${repo}/git/ref/tags/${tagName}`);
  const object = ref?.object;
  if (!object) {
    return null;
  }

  if (object.type === "commit") {
    return object.sha;
  }

  if (object.type === "tag") {
    const tag = await github.request(`/repos/${owner}/${repo}/git/tags/${object.sha}`);
    return tag?.object?.sha ?? null;
  }

  return null;
}

async function collectReleaseTagItem(github, { owner, repo, targetSha }) {
  const release = await github.request(`/repos/${owner}/${repo}/releases/latest`);
  const tagSha = release
    ? await resolveTagSha(github, {
        owner,
        repo,
        tagName: release.tag_name,
      })
    : null;

  return {
    label: "Latest Release Tag",
    kind: "release",
    ...itemStateFromReleaseTag({
      release,
      tagSha,
      targetSha,
    }),
  };
}

export async function collectReleaseHealth(github, { owner, repo, targetSha }) {
  const workflowItems = await collectWorkflowItems(github, { owner, repo, targetSha });
  const statusItems = await collectStatusItems(github, { owner, repo, targetSha });
  const checkItems = await collectCheckItems(github, { owner, repo, targetSha });
  const releaseTagItem = await collectReleaseTagItem(github, { owner, repo, targetSha });
  return [...workflowItems, ...statusItems, ...checkItems, releaseTagItem];
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repository = requireEnv("GITHUB_REPOSITORY");
  const targetSha = process.env.RELEASE_HEALTH_TARGET_SHA || requireEnv("GITHUB_SHA");
  const timeoutMs = Number(process.env.RELEASE_HEALTH_WAIT_TIMEOUT_MS ?? 20 * 60 * 1000);
  const intervalMs = Number(process.env.RELEASE_HEALTH_WAIT_INTERVAL_MS ?? 15 * 1000);
  const { owner, repo } = parseRepository(repository);
  const github = createGitHubClient({ token });
  const deadline = Date.now() + timeoutMs;
  let items = [];
  let summary = { status: "pending", failures: [], pending: [] };

  while (Date.now() <= deadline) {
    items = await collectReleaseHealth(github, {
      owner,
      repo,
      targetSha,
    });
    summary = summarizeHealth(items);

    if (summary.status !== "pending") {
      break;
    }

    console.log(
      `Release health pending: ${summary.pending.map((item) => item.label).join(", ")}`,
    );
    await sleep(intervalMs);
  }

  if (summary.status === "pending") {
    summary = summarizeHealth(items, { final: true });
  }

  const markdown = renderSummary({
    targetSha,
    items,
    summary,
  });
  console.log(markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  if (summary.status !== "success") {
    throw new Error(
      `Release health failed: ${summary.failures.map((item) => item.label).join(", ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
