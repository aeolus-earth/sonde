export interface ManagedUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ManagedSessionCostEstimate extends ManagedUsageTotals {
  runtimeSeconds: number;
  tokenCostUsd: number;
  runtimeCostUsd: number;
  totalCostUsd: number;
  pricingVersion: string;
  pricingSource: string;
}

interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheCreationUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
}

const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputUsdPerMTok: 3,
  outputUsdPerMTok: 15,
  cacheCreationUsdPerMTok: 3.75,
  cacheReadUsdPerMTok: 0.3,
};
const DEFAULT_MANAGED_RUNTIME_USD_PER_HOUR = 0.08;
const MANAGED_PRICING_VERSION = "anthropic-2026-04";
const MANAGED_PRICING_SOURCE = "anthropic-published-pricing";

function parseUsageNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getModelPricing(model: string | null | undefined): ModelPricing {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) return DEFAULT_MODEL_PRICING;
  if (normalized.includes("haiku")) {
    return {
      inputUsdPerMTok: 0.8,
      outputUsdPerMTok: 4,
      cacheCreationUsdPerMTok: 1,
      cacheReadUsdPerMTok: 0.08,
    };
  }
  if (normalized.includes("opus")) {
    return {
      inputUsdPerMTok: 15,
      outputUsdPerMTok: 75,
      cacheCreationUsdPerMTok: 18.75,
      cacheReadUsdPerMTok: 1.5,
    };
  }
  return DEFAULT_MODEL_PRICING;
}

export function extractManagedUsageTotals(usage: unknown): ManagedUsageTotals {
  const payload = usage && typeof usage === "object"
    ? (usage as Record<string, unknown>)
    : {};

  return {
    inputTokens: parseUsageNumber(payload.input_tokens),
    outputTokens: parseUsageNumber(payload.output_tokens),
    cacheCreationTokens:
      parseUsageNumber(payload.cache_creation_input_tokens) ||
      parseUsageNumber(payload.cache_creation_tokens),
    cacheReadTokens:
      parseUsageNumber(payload.cache_read_input_tokens) ||
      parseUsageNumber(payload.cache_read_tokens),
  };
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateManagedSessionCost(options: {
  model?: string | null;
  usage?: unknown;
  runtimeSeconds?: number;
  runtimeUsdPerHour?: number;
}): ManagedSessionCostEstimate {
  const usage = extractManagedUsageTotals(options.usage);
  const pricing = getModelPricing(options.model);
  const runtimeSeconds = Math.max(0, options.runtimeSeconds ?? 0);
  const runtimeUsdPerHour = Math.max(
    0,
    options.runtimeUsdPerHour ??
      Number(
        process.env.SONDE_MANAGED_RUNTIME_USD_PER_HOUR ??
          String(DEFAULT_MANAGED_RUNTIME_USD_PER_HOUR)
      )
  );

  const tokenCostUsd =
    (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMTok +
    (usage.cacheCreationTokens / 1_000_000) * pricing.cacheCreationUsdPerMTok +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadUsdPerMTok;
  const runtimeCostUsd = (runtimeSeconds / 3600) * runtimeUsdPerHour;

  return {
    ...usage,
    runtimeSeconds,
    tokenCostUsd: roundUsd(tokenCostUsd),
    runtimeCostUsd: roundUsd(runtimeCostUsd),
    totalCostUsd: roundUsd(tokenCostUsd + runtimeCostUsd),
    pricingVersion: MANAGED_PRICING_VERSION,
    pricingSource: MANAGED_PRICING_SOURCE,
  };
}

export interface ManagedCostThresholds {
  warnUsd: number;
  criticalUsd: number;
}

export function getManagedSessionCostThresholds(
  env: NodeJS.ProcessEnv = process.env
): ManagedCostThresholds {
  const warnUsd = Number(env.SONDE_MANAGED_SESSION_WARN_USD ?? "1");
  const criticalUsd = Number(env.SONDE_MANAGED_SESSION_CRITICAL_USD ?? "5");
  return {
    warnUsd: Number.isFinite(warnUsd) ? warnUsd : 1,
    criticalUsd: Number.isFinite(criticalUsd) ? criticalUsd : 5,
  };
}

export type ManagedCostAlertSeverity = "warn" | "critical";

export function getManagedCostAlertSeverity(
  totalCostUsd: number,
  env: NodeJS.ProcessEnv = process.env
): ManagedCostAlertSeverity | null {
  const thresholds = getManagedSessionCostThresholds(env);
  if (totalCostUsd >= thresholds.criticalUsd) {
    return "critical";
  }
  if (totalCostUsd >= thresholds.warnUsd) {
    return "warn";
  }
  return null;
}
