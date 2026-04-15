export class ManagedConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManagedConfigError";
    this.code = code;
  }
}

export interface ManagedSecretStatus {
  configured: boolean;
  valid: boolean;
  value: string | null;
  error: string | null;
}

export interface ManagedRuntimeConfigStatus {
  anthropic: ManagedSecretStatus;
  anthropicAdmin: ManagedSecretStatus;
  managedConfigured: boolean;
  managedConfigError: string | null;
}

function secretSyntaxError(name: string): string {
  return `${name} appears to contain unevaluated shell or template syntax.`;
}

function secretFormatError(name: string): string {
  return `${name} must be a single-line header-safe secret.`;
}

function secretPrefixError(name: string, prefix: string): string {
  return `${name} must start with ${prefix}.`;
}

function missingSecretError(name: string): string {
  return `${name} is not configured.`;
}

export function validateHeaderSafeSecret(
  name: string,
  rawValue: string | undefined,
  options: { prefix?: string } = {},
): ManagedSecretStatus {
  const value = rawValue?.trim() ?? "";
  if (!value) {
    return {
      configured: false,
      valid: false,
      value: null,
      error: missingSecretError(name),
    };
  }

  if (
    value.startsWith("$(") ||
    value.includes("${") ||
    value.includes("`") ||
    value.includes("<<")
  ) {
    return {
      configured: true,
      valid: false,
      value: null,
      error: secretSyntaxError(name),
    };
  }

  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    return {
      configured: true,
      valid: false,
      value: null,
      error: secretFormatError(name),
    };
  }

  if (options.prefix && !value.startsWith(options.prefix)) {
    return {
      configured: true,
      valid: false,
      value: null,
      error: secretPrefixError(name, options.prefix),
    };
  }

  return {
    configured: true,
    valid: true,
    value,
    error: null,
  };
}

function missingManagedEnvironmentError(): string {
  return "SONDE_MANAGED_ENVIRONMENT_ID is not configured.";
}

function missingManagedAgentError(): string {
  return "SONDE_MANAGED_AGENT_ID is not configured and SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT=1 is not enabled.";
}

export function getAnthropicApiKeyStatus(
  env: NodeJS.ProcessEnv = process.env,
): ManagedSecretStatus {
  return validateHeaderSafeSecret("ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY, {
    prefix: "sk-ant-",
  });
}

export function getAnthropicAdminApiKeyStatus(
  env: NodeJS.ProcessEnv = process.env,
): ManagedSecretStatus {
  return validateHeaderSafeSecret(
    "ANTHROPIC_ADMIN_API_KEY",
    env.ANTHROPIC_ADMIN_API_KEY,
    {
      prefix: "sk-ant-admin",
    },
  );
}

export function getManagedRuntimeConfigStatus(
  env: NodeJS.ProcessEnv = process.env,
): ManagedRuntimeConfigStatus {
  const anthropic = getAnthropicApiKeyStatus(env);
  const anthropicAdmin = getAnthropicAdminApiKeyStatus(env);
  const environmentId = env.SONDE_MANAGED_ENVIRONMENT_ID?.trim() ?? "";
  const agentId = env.SONDE_MANAGED_AGENT_ID?.trim() ?? "";
  const allowEphemeralAgent = env.SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT === "1";

  let managedConfigError: string | null = null;
  if (!anthropic.valid) {
    managedConfigError = anthropic.error;
  } else if (!environmentId) {
    managedConfigError = missingManagedEnvironmentError();
  } else if (!agentId && !allowEphemeralAgent) {
    managedConfigError = missingManagedAgentError();
  }

  return {
    anthropic,
    anthropicAdmin,
    managedConfigured: managedConfigError === null,
    managedConfigError,
  };
}

export function getAnthropicApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const status = getAnthropicApiKeyStatus(env);
  if (!status.valid || !status.value) {
    throw new ManagedConfigError(
      "anthropic_api_key_invalid",
      status.error ?? missingSecretError("ANTHROPIC_API_KEY"),
    );
  }
  return status.value;
}

export function getAnthropicAdminApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const status = getAnthropicAdminApiKeyStatus(env);
  if (!status.valid || !status.value) {
    throw new ManagedConfigError(
      "anthropic_admin_api_key_invalid",
      status.error ?? missingSecretError("ANTHROPIC_ADMIN_API_KEY"),
    );
  }
  return status.value;
}

export function assertManagedRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const status = getManagedRuntimeConfigStatus(env);
  if (!status.managedConfigured) {
    throw new ManagedConfigError(
      "managed_runtime_config_invalid",
      status.managedConfigError ?? "Claude Managed Agents are not configured.",
    );
  }
}

export function isManagedConfigError(
  error: unknown,
): error is ManagedConfigError {
  return error instanceof ManagedConfigError;
}
