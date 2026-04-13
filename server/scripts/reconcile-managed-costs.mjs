function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const httpBase = requiredEnv("MANAGED_COST_RECONCILE_HTTP_BASE").replace(/\/$/, "");
  const token = requiredEnv("MANAGED_COST_RECONCILE_TOKEN");
  const days = parsePositiveInt(process.env.MANAGED_COST_RECONCILE_DAYS, 7);

  const response = await fetch(`${httpBase}/internal/managed-costs/reconcile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ days }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Managed cost reconcile failed (${response.status}): ${bodyText}`);
  }

  console.log(`[managed-costs] Reconcile success ${bodyText}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[managed-costs] Failed:", message);
  process.exit(1);
});
