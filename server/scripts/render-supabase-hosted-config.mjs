import fs from "node:fs";
import path from "node:path";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function replaceSetting(source, key, value) {
  const pattern = new RegExp(`^${key}\\s*=\\s*.*$`, "m");
  if (!pattern.test(source)) {
    throw new Error(`Could not find setting '${key}' in config.`);
  }
  return source.replace(pattern, `${key} = ${value}`);
}

function replaceArraySetting(source, key, value) {
  const pattern = new RegExp(`^${key}\\s*=\\s*\\[[\\s\\S]*?^\\]`, "m");
  if (!pattern.test(source)) {
    throw new Error(`Could not find array setting '${key}' in config.`);
  }
  return source.replace(pattern, `${key} = ${value}`);
}

function main() {
  const configPath = path.resolve(process.argv[2] || "supabase/config.toml");
  const siteUrl = requiredEnv("SUPABASE_HOSTED_SITE_URL");
  const redirectUrls = requiredEnv("SUPABASE_HOSTED_ADDITIONAL_REDIRECT_URLS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fileSizeLimit = process.env.SUPABASE_HOSTED_STORAGE_FILE_SIZE_LIMIT?.trim() || "50MiB";

  let config = fs.readFileSync(configPath, "utf8");
  config = replaceSetting(config, "site_url", tomlString(siteUrl));
  config = replaceArraySetting(
    config,
    "additional_redirect_urls",
    tomlArray(redirectUrls)
  );
  config = replaceSetting(config, "file_size_limit", tomlString(fileSizeLimit));

  fs.writeFileSync(configPath, config);
  console.log(
    JSON.stringify({
      configPath,
      siteUrl,
      redirectUrls,
      fileSizeLimit,
    })
  );
}

main();
