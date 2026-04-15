import { getRuntimeEnvironment } from "../runtime-metadata.js";
import { createTelemetrySupabaseClient } from "../supabase.js";
import { getAnthropicCostReport } from "./client.js";

interface ParsedBucket {
  bucketStart: string;
  bucketEnd: string;
  workspaceId: string | null;
  description: string | null;
  amountCents: number;
  amountUsd: number;
  raw: Record<string, unknown>;
}

function parseNumeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseCostBuckets(payload: unknown): ParsedBucket[] {
  const response = payload && typeof payload === "object"
    ? (payload as { data?: Array<Record<string, unknown>> })
    : {};
  const buckets: ParsedBucket[] = [];
  for (const bucket of response.data ?? []) {
    const startingAt =
      typeof bucket.starting_at === "string" ? bucket.starting_at : null;
    const endingAt =
      typeof bucket.ending_at === "string" ? bucket.ending_at : null;
    if (!startingAt || !endingAt) continue;
    const results = Array.isArray(bucket.results) ? bucket.results : [];
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const raw = result as Record<string, unknown>;
      const amountUsd =
        parseNumeric(raw.amount_usd) ||
        parseNumeric(raw.amount) / 100 ||
        parseNumeric(raw.amount_cents) / 100;
      const amountCents =
        parseNumeric(raw.amount_cents) ||
        parseNumeric(raw.amount) ||
        Math.round(amountUsd * 100);
      buckets.push({
        bucketStart: startingAt,
        bucketEnd: endingAt,
        workspaceId:
          typeof raw.workspace_id === "string" ? raw.workspace_id : null,
        description:
          typeof raw.description === "string" ? raw.description : null,
        amountCents,
        amountUsd,
        raw,
      });
    }
  }
  return buckets;
}

export async function reconcileManagedCostBuckets(options: {
  requestedBy?: string | null;
  accessToken?: string | null;
  days?: number;
  environment?: string;
}): Promise<{
  mode: "provider" | "estimated_only";
  syncRunId: number | null;
  bucketCount: number;
  totalCostUsd: number;
  reason: string | null;
}> {
  const environment = options.environment ?? getRuntimeEnvironment();
  const endingAt = new Date();
  const windowDays = options.days ?? 7;
  const startingAt = new Date(endingAt.getTime() - windowDays * 24 * 60 * 60_000);
  const client = createTelemetrySupabaseClient(options.accessToken ?? undefined);

  const createRun = async (payload: {
    mode: "provider" | "estimated_only";
    success: boolean;
    bucketCount?: number;
    totalCostUsd?: number;
    errorMessage?: string | null;
    summary?: Record<string, unknown>;
  }): Promise<number | null> => {
    const { data, error } = await client
      .from("anthropic_cost_sync_runs")
      .insert({
        requested_by: options.requestedBy ?? null,
        environment,
        mode: payload.mode,
        success: payload.success,
        starting_at: startingAt.toISOString(),
        ending_at: endingAt.toISOString(),
        bucket_count: payload.bucketCount ?? 0,
        total_cost_usd: payload.totalCostUsd ?? 0,
        error_message: payload.errorMessage ?? null,
        summary: {
          window_days: windowDays,
          ...(payload.summary ?? {}),
        },
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return typeof data?.id === "number" ? data.id : null;
  };

  if (!process.env.ANTHROPIC_ADMIN_API_KEY?.trim()) {
    const syncRunId = await createRun({
      mode: "estimated_only",
      success: true,
      summary: { reason: "missing_admin_api_key" },
    });
    return {
      mode: "estimated_only",
      syncRunId,
      bucketCount: 0,
      totalCostUsd: 0,
      reason: "missing_admin_api_key",
    };
  }

  let page: string | null = null;
  const rawPages: unknown[] = [];

  try {
    for (;;) {
      const response = await getAnthropicCostReport({
        startingAt: startingAt.toISOString(),
        endingAt: endingAt.toISOString(),
        page,
      });
      rawPages.push(response);
      if (!response.next_page) {
        break;
      }
      page = response.next_page;
    }

    const parsedBuckets = rawPages.flatMap((pagePayload) => parseCostBuckets(pagePayload));
    const totalCostUsd = parsedBuckets.reduce((sum, bucket) => sum + bucket.amountUsd, 0);
    const workspaceIds = Array.from(
      new Set(parsedBuckets.map((bucket) => bucket.workspaceId).filter(Boolean))
    );

    const syncRunId = await createRun({
      mode: "provider",
      success: true,
      bucketCount: parsedBuckets.length,
      totalCostUsd,
      summary: {
        pages: rawPages.length,
        workspace_ids: workspaceIds,
      },
    });

    if (syncRunId != null && parsedBuckets.length > 0) {
      const { error } = await client.from("anthropic_cost_buckets").insert(
        parsedBuckets.map((bucket) => ({
          sync_run_id: syncRunId,
          bucket_start: bucket.bucketStart,
          bucket_end: bucket.bucketEnd,
          workspace_id: bucket.workspaceId,
          description: bucket.description,
          currency: "USD",
          amount_cents: bucket.amountCents,
          amount_usd: bucket.amountUsd,
          bucket_width: "1d",
          raw: bucket.raw,
        }))
      );
      if (error) throw error;
    }

    return {
      mode: "provider",
      syncRunId,
      bucketCount: parsedBuckets.length,
      totalCostUsd,
      reason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const syncRunId = await createRun({
      mode: "provider",
      success: false,
      errorMessage: message,
      summary: {
        pages: rawPages.length,
      },
    });
    throw Object.assign(new Error(message), { syncRunId });
  }
}
