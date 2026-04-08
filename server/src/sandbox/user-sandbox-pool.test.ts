import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SandboxHandle } from "./daytona-client.js";
import {
  cleanupExpiredUserSandboxes,
  disposeUserSandboxes,
  getUserSandboxLease,
  getUserSandboxPoolSize,
  setSandboxFactoryForTests,
} from "./user-sandbox-pool.js";

interface FakeSandbox extends SandboxHandle {
  tokenWrites: string[];
  execCommands: string[];
  pulledPrograms: string[];
  disposed: number;
}

function createFakeSandbox(label: string): FakeSandbox {
  return {
    ready: true,
    tokenWrites: [],
    execCommands: [],
    pulledPrograms: [],
    disposed: 0,
    async exec(command) {
      this.execCommands.push(`${label}:${command}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async execSondeCommand(command) {
      this.execCommands.push(`${label}:sonde:${command}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async readFile() {
      return "";
    },
    async writeFile() {
      return;
    },
    async listFiles() {
      return [];
    },
    async findFiles() {
      return [];
    },
    async setToken(token) {
      this.tokenWrites.push(token);
    },
    async pullCorpus(program) {
      this.pulledPrograms.push(program);
      return { exitCode: 0, stdout: "" };
    },
    async pullAllPrograms() {
      return 0;
    },
    async dispose() {
      this.disposed += 1;
    },
  };
}

afterEach(async () => {
  await disposeUserSandboxes();
  setSandboxFactoryForTests(null);
});

describe("user sandbox pool", () => {
  it("reuses a sandbox for the same user and isolates different users", async () => {
    const created: FakeSandbox[] = [];
    setSandboxFactoryForTests(async (userId) => {
      const sandbox = createFakeSandbox(userId);
      created.push(sandbox);
      return sandbox;
    });

    const first = await getUserSandboxLease({
      userId: "user-1",
      sessionId: "session-1",
      sondeToken: "token-a",
    });
    const second = await getUserSandboxLease({
      userId: "user-1",
      sessionId: "session-2",
      sondeToken: "token-b",
    });
    const third = await getUserSandboxLease({
      userId: "user-2",
      sessionId: "session-3",
      sondeToken: "token-c",
    });

    assert.ok(first);
    assert.ok(second);
    assert.ok(third);
    assert.equal(created.length, 2);
    assert.equal(getUserSandboxPoolSize(), 2);
    assert.deepEqual(created[0]?.tokenWrites, ["token-a", "token-b"]);
    assert.deepEqual(created[1]?.tokenWrites, ["token-c"]);
  });

  it("deduplicates corpus pulls per user sandbox", async () => {
    const sandbox = createFakeSandbox("user-1");
    setSandboxFactoryForTests(async () => sandbox);

    const lease = await getUserSandboxLease({
      userId: "user-1",
      sessionId: "session-1",
      sondeToken: "token-a",
    });

    assert.ok(lease);
    await Promise.all([
      lease?.ensureProgram("weather-intervention"),
      lease?.ensureProgram("weather-intervention"),
    ]);
    await lease?.ensureProgram("haps-navigation");

    assert.deepEqual(sandbox.pulledPrograms, [
      "weather-intervention",
      "haps-navigation",
    ]);
  });

  it("disposes idle sandboxes", async () => {
    const sandbox = createFakeSandbox("user-1");
    setSandboxFactoryForTests(async () => sandbox);

    await getUserSandboxLease({
      userId: "user-1",
      sessionId: "session-1",
      sondeToken: "token-a",
    });

    const disposed = await cleanupExpiredUserSandboxes(
      Date.now() + 31 * 60_000
    );

    assert.equal(disposed, 1);
    assert.equal(sandbox.disposed, 1);
  });
});
