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

function createOpaqueAgentToken() {
  return `sonde_ak_${crypto.randomBytes(32).toString("base64url")}`;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenPreview(token) {
  return `${token.slice(0, 16)}...${token.slice(-6)}`;
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

async function ensureCreatorAdminForPrograms(
  supabaseUrl,
  serviceRoleKey,
  creatorId,
  programs
) {
  const programQuery = encodeURIComponent(`in.(${programs.join(",")})`);
  const rows = await requestJson(
    `${supabaseUrl}/rest/v1/user_programs?select=program&user_id=eq.${creatorId}&role=eq.admin&program=${programQuery}`,
    {
      headers: adminHeaders(serviceRoleKey),
    }
  );

  const administered = new Set(rows.map((row) => row.program));
  const missing = programs.filter((program) => !administered.has(program));
  if (missing.length > 0) {
    throw new Error(
      `Creator is not an admin of requested programs: ${missing.join(", ")}`
    );
  }
}

async function insertAgentTokenRow(
  supabaseUrl,
  serviceRoleKey,
  tokenId,
  tokenName,
  tokenPrograms,
  createdBy,
  expiresAt,
  opaqueToken
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
      token_hash: tokenHash(opaqueToken),
      token_prefix: "sonde_ak_",
      token_preview: tokenPreview(opaqueToken),
    }),
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

  if (tokenPrograms.length === 0) {
    throw new Error("TOKEN_PROGRAMS must contain at least one program.");
  }

  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    throw new Error("TOKEN_EXPIRES_DAYS must be a positive integer.");
  }

  await ensureProgramsExist(supabaseUrl, serviceRoleKey, tokenPrograms);

  const creator = await findUserByEmail(supabaseUrl, serviceRoleKey, creatorEmail);
  if (!creator?.id) {
    throw new Error(`Could not find creator user for ${creatorEmail}.`);
  }
  await ensureCreatorAdminForPrograms(
    supabaseUrl,
    serviceRoleKey,
    creator.id,
    tokenPrograms
  );

  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const token = createOpaqueAgentToken();

  try {
    await insertAgentTokenRow(
      supabaseUrl,
      serviceRoleKey,
      tokenId,
      tokenName,
      tokenPrograms,
      creator.id,
      expiresAt,
      token
    );
  } catch (error) {
    await deleteAgentTokenRow(supabaseUrl, serviceRoleKey, tokenId);
    throw error;
  }

  setOutput("token", token);
  setOutput("token_id", tokenId);
  console.log(
    JSON.stringify({
      tokenId,
      tokenName,
      programs: tokenPrograms,
      expiresAt,
      tokenPreview: tokenPreview(token),
    })
  );
}

main().catch((error) => {
  console.error("[create-agent-token] Failed:", error.message);
  process.exit(1);
});
