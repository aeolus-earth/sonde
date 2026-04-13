import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const target = process.argv[2];

  if (!target) {
    console.error(
      "Usage: npx tsx scripts/ci/read-vercel-config.ts <path-to-vercel-config>"
    );
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), target);
  const moduleUrl = pathToFileURL(resolved).href;
  const imported = await import(moduleUrl);

  console.log(JSON.stringify(imported.default ?? imported));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
