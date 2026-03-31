/**
 * Post-build check: resolved CLI dir, uv + sonde --help, runSonde(doctor --json).
 * Run: npm run build && node scripts/smoke.mjs
 */
import { probeSondeCliEnvironment, runSonde } from "../dist/sonde-runner.js";

await probeSondeCliEnvironment();

const r = await runSonde(["doctor", "--json"], "smoke-test-token");
const text = r.content[0]?.text ?? "";
if (!text.trimStart().startsWith("{")) {
  console.error("smoke: expected JSON from sonde doctor --json, got:", text.slice(0, 200));
  process.exit(1);
}

console.log("smoke: runSonde(doctor --json) returned JSON ok");
