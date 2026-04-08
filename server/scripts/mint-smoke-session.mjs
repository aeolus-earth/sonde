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

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}<<EOF\n${value}\nEOF\n`);
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
  setOutput("session_json", sessionJson);
  setOutput("access_token", session.access_token);
  setOutput("user_id", session.user?.id ?? "");

  console.log(sessionJson);
}

main().catch((error) => {
  console.error("[mint-smoke-session] Failed:", error.message);
  process.exit(1);
});
