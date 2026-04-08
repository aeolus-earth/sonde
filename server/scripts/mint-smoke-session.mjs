import fs from "node:fs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      body?.msg ||
      body?.error_description ||
      body?.error ||
      response.statusText;
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  return body;
}

function writeJsonFile(path, value) {
  if (!path) return;
  fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
  const email = requiredEnv("SMOKE_USER_EMAIL");
  const password = requiredEnv("SMOKE_USER_PASSWORD");

  const session = await requestJson(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    }
  );

  const sessionJson = JSON.stringify(session);
  writeJsonFile(process.env.SMOKE_SESSION_FILE?.trim(), session);

  console.log(sessionJson);
}

main().catch((error) => {
  console.error("[mint-smoke-session] Failed:", error.message);
  process.exit(1);
});
