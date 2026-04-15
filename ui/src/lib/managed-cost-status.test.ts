import { describe, expect, it } from "vitest";
import {
  managedProviderHeadlineValue,
  managedProviderStatusDescription,
  managedProviderStatusLabel,
  managedProviderStatusVariant,
  type ManagedProviderCostStatus,
} from "./managed-cost-status";

function buildStatus(
  overrides: Partial<ManagedProviderCostStatus> = {},
): ManagedProviderCostStatus {
  return {
    mode: "provider",
    configured: true,
    reconcileConfigured: true,
    reason: "ok",
    stale: false,
    latestSuccessfulAt: "2026-04-15T00:00:00.000Z",
    latestAttemptedAt: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("managed cost status helpers", () => {
  it("renders a clean provider-backed state", () => {
    const status = buildStatus();
    expect(managedProviderStatusLabel(status)).toBe("provider-backed");
    expect(managedProviderStatusVariant(status)).toBe("complete");
    expect(managedProviderHeadlineValue(status, "$3.00")).toBe("$3.00");
  });

  it("marks stale provider-backed data separately", () => {
    const status = buildStatus({ stale: true, reason: "provider_sync_stale" });
    expect(managedProviderStatusLabel(status)).toBe("provider-stale");
    expect(managedProviderStatusVariant(status)).toBe("open");
    expect(managedProviderStatusDescription(status)).toMatch(/stale/i);
  });

  it("treats estimated-only reconciles as non-provider totals", () => {
    const status = buildStatus({ mode: "estimated_only", reason: "estimated_only" });
    expect(managedProviderStatusLabel(status)).toBe("estimated-only");
    expect(managedProviderStatusVariant(status)).toBe("tag");
    expect(managedProviderHeadlineValue(status, "$0.00")).toBe("Estimate only");
  });

  it("surfaces missing hosted secrets as unavailable provider spend", () => {
    const status = buildStatus({
      mode: "unavailable",
      configured: false,
      reconcileConfigured: false,
      reason: "missing_admin_api_key",
    });
    expect(managedProviderStatusLabel(status)).toBe("unavailable");
    expect(managedProviderStatusVariant(status)).toBe("failed");
    expect(managedProviderHeadlineValue(status, "$0.00")).toBe("Unavailable");
    expect(managedProviderStatusDescription(status)).toMatch(/ANTHROPIC_ADMIN_API_KEY/);
  });
});
