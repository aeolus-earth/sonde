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
      body?.message ||
      body?.error_description ||
      body?.error ||
      response.statusText;
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  return body;
}

function adminHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
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

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const email = requiredEnv("SMOKE_USER_EMAIL");
  const password = requiredEnv("SMOKE_USER_PASSWORD");
  const role = (process.env.SMOKE_USER_ROLE?.trim() || "member").toLowerCase();
  const programs = requiredEnv("SMOKE_USER_PROGRAMS")
    .split(",")
    .map((program) => program.trim())
    .filter(Boolean);
  const fullName =
    process.env.SMOKE_USER_NAME?.trim() || email.split("@")[0] || "Smoke User";

  if (!["member", "admin"].includes(role)) {
    throw new Error("SMOKE_USER_ROLE must be either 'member' or 'admin'.");
  }

  await ensureProgramsExist(supabaseUrl, serviceRoleKey, programs);

  const existing = await findUserByEmail(supabaseUrl, serviceRoleKey, email);
  const payload = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      smoke_test: true,
    },
    app_metadata: {
      provider: "email",
      providers: ["email"],
      smoke_test: true,
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
    throw new Error("Supabase did not return a user id for the smoke user.");
  }

  await upsertProgramMemberships(supabaseUrl, serviceRoleKey, userId, programs, role);

  const summary = {
    id: userId,
    email,
    programs,
    role,
    created: !existing,
  };

  setOutput("user_id", userId);
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error("[provision-smoke-user] Failed:", error.message);
  process.exit(1);
});
