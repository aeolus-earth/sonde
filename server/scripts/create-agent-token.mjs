import crypto from "node:crypto";
import fs from "node:fs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

function adminHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

async function requestJson(url, init) {
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
    throw new Error(`Request failed (${response.status}): ${message}`);
  }

  return body;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function encodeBotToken(bundle) {
  const payload = stableSerialize(bundle);
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `sonde_bt_${encoded}`;
}

function botEmailForToken(tokenName, tokenId) {
  const slug = tokenName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  const suffix = tokenId.replace(/-/g, "").slice(0, 12);
  return `${slug}-${suffix}@aeolus.earth`;
}

function botPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

async function findUserByEmail(supabaseUrl, serviceRoleKey, email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const data = await requestJson(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: adminHeaders(serviceRoleKey),
      }
    );

    const users = Array.isArray(data?.users) ? data.users : [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return found;
    }

    const total = Number(data?.total ?? 0);
    if (users.length === 0 || page * perPage >= total) {
      return null;
    }
    page += 1;
  }
}

async function ensureProgramsExist(supabaseUrl, serviceRoleKey, programs) {
  const query = encodeURIComponent(`in.(${programs.join(",")})`);
  const rows = await requestJson(
    `${supabaseUrl}/rest/v1/programs?select=id&id=${query}`,
    {
      headers: adminHeaders(serviceRoleKey),
    }
  );

  const existing = new Set(rows.map((row) => row.id));
  const missing = programs.filter((program) => !existing.has(program));
  if (missing.length > 0) {
    throw new Error(`Programs do not exist: ${missing.join(", ")}`);
  }
}

async function insertAgentTokenRow(
  supabaseUrl,
  serviceRoleKey,
  tokenId,
  tokenName,
  tokenPrograms,
  createdBy,
  expiresAt
) {
  await requestJson(`${supabaseUrl}/rest/v1/agent_tokens`, {
    method: "POST",
    headers: {
      ...adminHeaders(serviceRoleKey),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      id: tokenId,
      name: tokenName,
      programs: tokenPrograms,
      created_by: createdBy,
      expires_at: expiresAt,
    }),
  });
}

async function createBotAuthUser(
  supabaseUrl,
  serviceRoleKey,
  tokenId,
  tokenName,
  botEmail,
  password
) {
  return requestJson(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(serviceRoleKey),
    body: JSON.stringify({
      email: botEmail,
      password,
      email_confirm: true,
      app_metadata: {
        agent: true,
        token_id: tokenId,
        token_name: tokenName,
        agent_name: tokenName,
      },
      user_metadata: {
        agent_name: tokenName,
      },
    }),
  });
}

async function upsertProgramMemberships(supabaseUrl, serviceRoleKey, userId, programs) {
  await requestJson(`${supabaseUrl}/rest/v1/user_programs?on_conflict=user_id,program`, {
    method: "POST",
    headers: {
      ...adminHeaders(serviceRoleKey),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(
      programs.map((program) => ({
        user_id: userId,
        program,
        role: "member",
      }))
    ),
  });
}

async function deleteBotAuthUser(supabaseUrl, serviceRoleKey, userId) {
  if (!userId) return;
  await requestJson(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders(serviceRoleKey),
  });
}

async function deleteAgentTokenRow(supabaseUrl, serviceRoleKey, tokenId) {
  if (!tokenId) return;
  await requestJson(`${supabaseUrl}/rest/v1/agent_tokens?id=eq.${tokenId}`, {
    method: "DELETE",
    headers: {
      ...adminHeaders(serviceRoleKey),
      Prefer: "return=minimal",
    },
  });
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const creatorEmail = requiredEnv("TOKEN_ADMIN_EMAIL");
  const tokenName = requiredEnv("TOKEN_NAME");
  const tokenPrograms = requiredEnv("TOKEN_PROGRAMS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const expiresInDays = Number.parseInt(process.env.TOKEN_EXPIRES_DAYS ?? "365", 10);

  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    throw new Error("TOKEN_EXPIRES_DAYS must be a positive integer.");
  }

  await ensureProgramsExist(supabaseUrl, serviceRoleKey, tokenPrograms);

  const creator = await findUserByEmail(supabaseUrl, serviceRoleKey, creatorEmail);
  if (!creator?.id) {
    throw new Error(`Could not find creator user for ${creatorEmail}.`);
  }

  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const botUserEmail = botEmailForToken(tokenName, tokenId);
  const password = botPassword();

  let authUserId = "";
  try {
    await insertAgentTokenRow(
      supabaseUrl,
      serviceRoleKey,
      tokenId,
      tokenName,
      tokenPrograms,
      creator.id,
      expiresAt
    );

    const createdUser = await createBotAuthUser(
      supabaseUrl,
      serviceRoleKey,
      tokenId,
      tokenName,
      botUserEmail,
      password
    );

    authUserId = createdUser.user?.id ?? createdUser.id ?? "";
    if (!authUserId) {
      throw new Error("Supabase did not return the created bot user id.");
    }

    await upsertProgramMemberships(supabaseUrl, serviceRoleKey, authUserId, tokenPrograms);
  } catch (error) {
    await Promise.allSettled([
      deleteBotAuthUser(supabaseUrl, serviceRoleKey, authUserId),
      deleteAgentTokenRow(supabaseUrl, serviceRoleKey, tokenId),
    ]);
    throw error;
  }

  const token = encodeBotToken({
    email: botUserEmail,
    expires_at: expiresAt,
    name: tokenName,
    password,
    programs: tokenPrograms,
    token_id: tokenId,
  });

  setOutput("token", token);
  setOutput("token_id", tokenId);
  console.log(
    JSON.stringify({
      tokenId,
      tokenName,
      botUserEmail,
      programs: tokenPrograms,
      expiresAt,
    })
  );
}

main().catch((error) => {
  console.error("[create-agent-token] Failed:", error.message);
  process.exit(1);
});
