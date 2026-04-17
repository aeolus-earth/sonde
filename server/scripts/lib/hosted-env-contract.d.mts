export interface HostedEnvironmentContract {
  schemaVersion: number;
  parity: Record<string, unknown>;
  environments: Record<string, Record<string, unknown>>;
}

export interface ResolvedHostedEnvironment {
  schemaVersion: number;
  name: string;
  githubEnvironment: string;
  runtimeEnvironment: string;
  agentBackend: string;
  uiUrl: string;
  agentUrl: string;
  supabaseProjectRef: string;
  supabaseAnonKey: string;
  smokeUserEmailConfigured: boolean;
  smokeUserPasswordConfigured: boolean;
  cliAuditTokenConfigured: boolean;
  runtimeAuditTokenConfigured: boolean;
  redisUrlConfigured: boolean;
  redisTokenConfigured: boolean;
  googleClientIdConfigured: boolean;
  googleClientSecretConfigured: boolean;
  requireSharedRateLimit: boolean;
  agentRuntimeSecretNames: string[];
  requirements: {
    agentUrlRequired: boolean;
    supabaseProjectRefRequired: boolean;
    supabaseAnonKeyRequired: boolean;
    smokeUserRequired: boolean;
    cliAuditTokenRequired: boolean;
    runtimeAuditTokenRequired: boolean;
    googleOAuthRequired: boolean;
    requireManagedAuth: boolean;
  };
  storageFileSizeLimit: string;
  supabaseRedirectUrls: string[];
  expectedProgramId: string;
  expectedExperimentId: string;
  expectedTimelineAuthMode: string;
  audit: {
    requireAnthropic: boolean;
    requireAgentCommitMatch: boolean;
    requireFirstPartyAgent: boolean;
    requiredRuntimeKeys: string[];
    waitTimeoutMs: number;
    waitIntervalMs: number;
  };
  managedAuthAudit: {
    prompt: string;
    expectSubstring: string;
    staleSession: boolean;
    requireToolUse: boolean;
    timeoutMs: number;
    prewarmTimeoutMs: number;
    retryIntervalMs: number;
  };
}

export function loadHostedEnvironmentContract(
  contractPath?: string,
): HostedEnvironmentContract;

export function validateHostedEnvironmentContract(
  contract: HostedEnvironmentContract,
): string[];

export function resolveHostedEnvironment(
  name: string,
  env?: NodeJS.ProcessEnv,
  contract?: HostedEnvironmentContract,
): ResolvedHostedEnvironment;

export function validateResolvedHostedEnvironment(
  resolved: ResolvedHostedEnvironment,
  profile?: HostedValidationProfile,
): string[];

export function formatHostedEnvironmentForGithubOutputs(
  resolved: ResolvedHostedEnvironment,
): Record<string, string>;
