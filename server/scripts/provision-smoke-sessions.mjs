import crypto from "node:crypto";
import fs from "node:fs";

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
    throw new Error(`Request failed (${response.status}) for ${url}: ${message}`);
  }

  return body;
}

function writeJsonFile(path, value) {
  if (!path) return;
  fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
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

async function upsertProgramMemberships(supabaseUrl, serviceRoleKey, userId, programs, role) {
  await requestJson(
    `${supabaseUrl}/rest/v1/user_programs?on_conflict=user_id,program`,
    {
      method: "POST",
      headers: {
        ...adminHeaders(serviceRoleKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(
        programs.map((program) => ({
          user_id: userId,
          program,
          role,
        }))
      ),
    }
  );
}

async function upsertSmokeUser({
  supabaseUrl,
  serviceRoleKey,
  email,
  password,
  fullName,
  role,
  programs,
}) {
  const existing = await findUserByEmail(supabaseUrl, serviceRoleKey, email);
  const payload = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      smoke_test: true,
      soak_test: true,
    },
    app_metadata: {
      provider: "email",
      providers: ["email"],
      smoke_test: true,
      soak_test: true,
    },
  };

  const user = existing
    ? await requestJson(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
        method: "PUT",
        headers: adminHeaders(serviceRoleKey),
        body: JSON.stringify(payload),
      })
    : await requestJson(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders(serviceRoleKey),
        body: JSON.stringify(payload),
      });

  const userId = user.user?.id ?? user.id;
  if (!userId) {
    throw new Error(`Supabase did not return a user id for ${email}.`);
  }

  await upsertProgramMemberships(supabaseUrl, serviceRoleKey, userId, programs, role);
  return { userId, created: !existing };
}

async function mintSession({ supabaseUrl, supabaseAnonKey, email, password }) {
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

  if (!session.access_token) {
    throw new Error(`Supabase did not return an access token for ${email}.`);
  }

  return session;
}

function buildEmail(prefix, index, domain) {
  const slug = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sonde-smoke";
  return `${slug}-${String(index).padStart(2, "0")}@${domain}`;
}

function buildPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
  const count = parsePositiveInt(process.env.SMOKE_USER_COUNT, 10);
  const prefix = process.env.SMOKE_USER_PREFIX?.trim() || "sonde-staging-soak";
  const domain = process.env.SMOKE_USER_DOMAIN?.trim() || "aeolus.earth";
  const role = (process.env.SMOKE_USER_ROLE?.trim() || "member").toLowerCase();
  const programs = requiredEnv("SMOKE_USER_PROGRAMS")
    .split(",")
    .map((program) => program.trim())
    .filter(Boolean);

  if (!["member", "admin"].includes(role)) {
    throw new Error("SMOKE_USER_ROLE must be either 'member' or 'admin'.");
  }

  await ensureProgramsExist(supabaseUrl, serviceRoleKey, programs);

  const accessTokens = [];
  const emails = [];
  const users = [];

  for (let index = 1; index <= count; index += 1) {
    const email = buildEmail(prefix, index, domain);
    const password = buildPassword();
    const fullName = `Sonde Soak ${index}`;
    const result = await upsertSmokeUser({
      supabaseUrl,
      serviceRoleKey,
      email,
      password,
      fullName,
      role,
      programs,
    });
    const session = await mintSession({
      supabaseUrl,
      supabaseAnonKey,
      email,
      password,
    });

    emails.push(email);
    accessTokens.push(session.access_token);
    users.push({
      email,
      userId: result.userId,
      created: result.created,
    });
  }

  const summary = {
    count,
    prefix,
    programs,
    role,
    emails,
    users,
  };

  writeJsonFile(process.env.SMOKE_SESSION_FILE?.trim(), {
    access_tokens: accessTokens,
    emails,
  });
  writeJsonFile(process.env.SMOKE_USERS_FILE?.trim(), {
    count,
    prefix,
    programs,
    role,
    users,
  });
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error("[provision-smoke-sessions] Failed:", error.message);
  process.exit(1);
});
