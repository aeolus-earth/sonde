export interface ManagedProviderCostStatus {
  mode: "provider" | "estimated_only" | "unavailable";
  configured: boolean;
  reconcileConfigured: boolean;
  reason:
    | "ok"
    | "missing_admin_api_key"
    | "missing_internal_admin_token"
    | "estimated_only"
    | "provider_sync_failed"
    | "provider_sync_stale"
    | "missing_selected_window_provider_sync"
    | "no_provider_sync";
  stale: boolean;
  latestSuccessfulAt: string | null;
  latestAttemptedAt: string | null;
}

export function managedProviderStatusLabel(
  status: ManagedProviderCostStatus,
): string {
  if (status.mode === "provider") {
    return status.stale ? "provider-stale" : "provider-backed";
  }
  if (status.mode === "estimated_only") {
    return "estimated-only";
  }
  return "unavailable";
}

export function managedProviderStatusVariant(
  status: ManagedProviderCostStatus,
): "complete" | "tag" | "open" | "failed" {
  if (status.mode === "provider" && !status.stale) {
    return "complete";
  }
  if (status.mode === "provider" && status.stale) {
    return "open";
  }
  if (status.mode === "estimated_only") {
    return "tag";
  }
  return "failed";
}

export function managedProviderHeadlineValue(
  status: ManagedProviderCostStatus,
  amountUsd: string,
): string {
  if (status.mode === "provider") {
    return amountUsd;
  }
  if (status.mode === "estimated_only") {
    return "Estimate only";
  }
  return "Unavailable";
}

export function managedProviderStatusDescription(
  status: ManagedProviderCostStatus,
): string {
  switch (status.reason) {
    case "ok":
      return "Provider-backed reconciliation is healthy for the selected window.";
    case "missing_admin_api_key":
      return "ANTHROPIC_ADMIN_API_KEY is not configured, so provider-backed costs are unavailable.";
    case "missing_internal_admin_token":
      return "SONDE_INTERNAL_ADMIN_TOKEN is missing, so scheduled provider reconciliation cannot run.";
    case "estimated_only":
      return "The latest reconcile completed in estimated-only mode, so the provider total is unavailable.";
    case "provider_sync_failed":
      return "The latest provider reconciliation failed.";
    case "provider_sync_stale":
      return "Provider-backed reconciliation is stale. Refresh the provider sync before trusting this total.";
    case "missing_selected_window_provider_sync":
      return "No successful provider-backed reconcile exists for the selected window yet.";
    case "no_provider_sync":
    default:
      return "No provider-backed reconciliation has completed yet.";
  }
}
