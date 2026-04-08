import fs from "node:fs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function adminHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

async function request(url, init) {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      body?.msg ||
      body?.message ||
      body?.error_description ||
      body?.error ||
      response.statusText;
    throw new Error(`Request failed (${response.status}) for ${url}: ${message}`);
  }

  return body;
}

async function deleteUser(supabaseUrl, serviceRoleKey, userId) {
  await request(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders(serviceRoleKey),
  });
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const usersFile = requiredEnv("SMOKE_USERS_FILE");

  if (!fs.existsSync(usersFile)) {
    throw new Error(`Smoke user file does not exist: ${usersFile}`);
  }

  const payload = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  const users = Array.isArray(payload?.users) ? payload.users : [];

  const deleted = [];
  const failures = [];
  for (const user of users) {
    const userId = typeof user?.userId === "string" ? user.userId : "";
    const email = typeof user?.email === "string" ? user.email : "";
    if (!userId) continue;
    try {
      await deleteUser(supabaseUrl, serviceRoleKey, userId);
      deleted.push({ userId, email });
    } catch (error) {
      failures.push({
        userId,
        email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify({
      deleted_count: deleted.length,
      failed_count: failures.length,
      failures,
    }),
  );

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[cleanup-smoke-users] Failed:", error.message);
  process.exit(1);
});
