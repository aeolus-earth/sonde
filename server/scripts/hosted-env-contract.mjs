import {
  formatHostedEnvironmentForLogs,
  formatHostedEnvironmentForGithubOutputs,
  loadHostedEnvironmentContract,
  resolveHostedEnvironment,
  resolveHostedGithubEnvironmentEnv,
  validateHostedEnvironmentContract,
  validateResolvedHostedEnvironment,
} from "./lib/hosted-env-contract.mjs";

function printGithubOutput(name, value) {
  const normalized = value == null ? "" : String(value);
  if (!/[\n\r]/.test(normalized)) {
    console.log(`${name}=${normalized}`);
    return;
  }

  const delimiter = `EOF_${name.toUpperCase()}`;
  console.log(`${name}<<${delimiter}`);
  console.log(normalized);
  console.log(delimiter);
}

function usage() {
  console.error(
    "Usage: node server/scripts/hosted-env-contract.mjs <check-parity|validate|resolve-github-outputs|export-github-env|print-json> [environment]",
  );
  process.exit(1);
}

function runCheckParity() {
  const contract = loadHostedEnvironmentContract();
  const errors = validateHostedEnvironmentContract(contract);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[hosted-env-contract] ${error}`);
    }
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        schemaVersion: contract.schemaVersion,
        environments: Object.keys(contract.environments ?? {}),
      },
      null,
      2,
    ),
  );
}

function runValidate(environmentName) {
  const contract = loadHostedEnvironmentContract();
  const contractErrors = validateHostedEnvironmentContract(contract);
  const resolved = resolveHostedEnvironment(environmentName, process.env, contract);
  const errors = [
    ...contractErrors,
    ...validateResolvedHostedEnvironment(resolved),
  ];

  const summary = {
    status: errors.length === 0 ? "ok" : "error",
    environment: environmentName,
    resolved: formatHostedEnvironmentForLogs(resolved),
    errors,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (errors.length > 0) {
    process.exit(1);
  }
}

function runResolveGithubOutputs(environmentName) {
  const contract = loadHostedEnvironmentContract();
  const contractErrors = validateHostedEnvironmentContract(contract);
  if (contractErrors.length > 0) {
    for (const error of contractErrors) {
      console.error(`[hosted-env-contract] ${error}`);
    }
    process.exit(1);
  }

  const resolved = resolveHostedEnvironment(environmentName, process.env, contract);
  const outputs = formatHostedEnvironmentForGithubOutputs(resolved);
  for (const [name, value] of Object.entries(outputs)) {
    printGithubOutput(name, value);
  }
}

function runExportGithubEnv(environmentName) {
  const contract = loadHostedEnvironmentContract();
  const contractErrors = validateHostedEnvironmentContract(contract);
  const hostedEnv = resolveHostedGithubEnvironmentEnv(process.env);
  const resolved = resolveHostedEnvironment(
    environmentName,
    { ...process.env, ...hostedEnv },
    contract,
  );
  const errors = [
    ...contractErrors,
    ...validateResolvedHostedEnvironment(resolved),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[hosted-env-contract] ${error}`);
    }
    process.exit(1);
  }

  for (const [name, value] of Object.entries(hostedEnv)) {
    printGithubOutput(name, value);
  }
}

function runPrintJson(environmentName) {
  const resolved = resolveHostedEnvironment(environmentName);
  console.log(JSON.stringify(formatHostedEnvironmentForLogs(resolved), null, 2));
}

const command = process.argv[2];
const environmentName = process.argv[3];

if (!command) {
  usage();
}

switch (command) {
  case "check-parity":
    runCheckParity();
    break;
  case "validate":
    if (!environmentName) usage();
    runValidate(environmentName);
    break;
  case "resolve-github-outputs":
    if (!environmentName) usage();
    runResolveGithubOutputs(environmentName);
    break;
  case "export-github-env":
    if (!environmentName) usage();
    runExportGithubEnv(environmentName);
    break;
  case "print-json":
    if (!environmentName) usage();
    runPrintJson(environmentName);
    break;
  default:
    usage();
}
