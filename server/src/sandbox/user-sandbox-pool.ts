import type { SandboxHandle } from "./daytona-client.js";

const USER_SANDBOX_IDLE_TTL_MS = 30 * 60_000;
const SESSION_ROOT = "/home/daytona/sessions";

interface UserSandboxEntry {
  userId: string;
  sandbox: SandboxHandle | null;
  initPromise: Promise<SandboxHandle | null> | null;
  lastUsedAt: number;
  pulledPrograms: Set<string>;
  pullPromises: Map<string, Promise<void>>;
}

export interface UserSandboxLease {
  sandbox: SandboxHandle;
  sessionDir: string;
  ensureProgram(program: string): Promise<void>;
  release(): Promise<void>;
}

const userSandboxes = new Map<string, UserSandboxEntry>();
let sandboxFactory = initUserSandbox;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function initUserSandbox(
  userId: string,
  sondeToken: string,
  supabaseUrl?: string,
  supabaseKey?: string
): Promise<SandboxHandle | null> {
  const { initSandbox } = await import("./sandbox-init.js");
  try {
    return await initSandbox({
      sondeToken,
      supabaseUrl,
      supabaseKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "init failed";
    console.error(`[sandbox] Failed to initialize sandbox for ${userId}:`, message);
    return null;
  }
}

async function getOrCreateEntry(
  userId: string,
  sondeToken: string,
  supabaseUrl?: string,
  supabaseKey?: string
): Promise<UserSandboxEntry | null> {
  const now = Date.now();
  const existing = userSandboxes.get(userId);
  if (existing?.sandbox?.ready) {
    existing.lastUsedAt = now;
    return existing;
  }

  if (existing?.initPromise) {
    const sandbox = await existing.initPromise;
    if (!sandbox) return null;
    existing.sandbox = sandbox;
    existing.lastUsedAt = now;
    return existing;
  }

  const entry: UserSandboxEntry = existing ?? {
    userId,
    sandbox: null,
    initPromise: null,
    lastUsedAt: now,
    pulledPrograms: new Set<string>(),
    pullPromises: new Map<string, Promise<void>>(),
  };

  entry.initPromise = sandboxFactory(userId, sondeToken, supabaseUrl, supabaseKey);
  userSandboxes.set(userId, entry);

  const sandbox = await entry.initPromise;
  entry.initPromise = null;
  entry.lastUsedAt = now;

  if (!sandbox) {
    userSandboxes.delete(userId);
    return null;
  }

  entry.sandbox = sandbox;
  userSandboxes.set(userId, entry);
  return entry;
}

function createScopedSandbox(baseSandbox: SandboxHandle, sessionDir: string): SandboxHandle {
  return {
    sessionDir,

    get ready() {
      return baseSandbox.ready;
    },

    exec(command, opts) {
      return baseSandbox.exec(command, {
        ...opts,
        cwd: opts?.cwd ?? sessionDir,
      });
    },

    execSondeCommand(command, opts) {
      return baseSandbox.execSondeCommand(command, {
        ...opts,
        cwd: opts?.cwd ?? sessionDir,
      });
    },

    readFile(path) {
      return baseSandbox.readFile(path);
    },

    writeFile(path, content) {
      return baseSandbox.writeFile(path, content);
    },

    listFiles(path) {
      return baseSandbox.listFiles(path);
    },

    findFiles(path, pattern) {
      return baseSandbox.findFiles(path, pattern);
    },

    setToken(token) {
      return baseSandbox.setToken(token);
    },

    pullCorpus(program) {
      return baseSandbox.pullCorpus(program);
    },

    pullAllPrograms() {
      return baseSandbox.pullAllPrograms();
    },

    async dispose() {
      await baseSandbox.exec(`rm -rf ${shellQuote(sessionDir)}`, { timeout: 10 }).catch(() => {});
    },
  };
}

async function ensureProgramForEntry(
  entry: UserSandboxEntry,
  program: string
): Promise<void> {
  if (!entry.sandbox) {
    throw new Error("Sandbox not initialized");
  }
  if (entry.pulledPrograms.has(program)) return;

  const existing = entry.pullPromises.get(program);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    const result = await entry.sandbox!.pullCorpus(program);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to pull Sonde corpus for ${program}: ${result.stdout.slice(0, 240)}`
      );
    }
    entry.pulledPrograms.add(program);
  })();

  entry.pullPromises.set(program, promise);
  try {
    await promise;
  } finally {
    entry.pullPromises.delete(program);
  }
}

export async function getUserSandboxLease(options: {
  userId: string;
  sessionId: string;
  sondeToken: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}): Promise<UserSandboxLease | null> {
  const entry = await getOrCreateEntry(
    options.userId,
    options.sondeToken,
    options.supabaseUrl,
    options.supabaseKey
  );
  if (!entry?.sandbox) return null;

  entry.lastUsedAt = Date.now();
  await entry.sandbox.setToken(options.sondeToken);

  const sessionDir = `${SESSION_ROOT}/${options.sessionId}`;
  await entry.sandbox.exec(
    `mkdir -p ${shellQuote(SESSION_ROOT)} ${shellQuote(sessionDir)}`,
    { timeout: 10 }
  );

  const scopedSandbox = createScopedSandbox(entry.sandbox, sessionDir);

  return {
    sandbox: scopedSandbox,
    sessionDir,
    ensureProgram: async (program: string) => {
      entry.lastUsedAt = Date.now();
      await ensureProgramForEntry(entry, program);
    },
    release: async () => {
      entry.lastUsedAt = Date.now();
      await scopedSandbox.dispose();
    },
  };
}

export async function cleanupExpiredUserSandboxes(
  now: number = Date.now()
): Promise<number> {
  let disposed = 0;
  for (const [userId, entry] of userSandboxes.entries()) {
    if (!entry.sandbox) continue;
    if (now - entry.lastUsedAt < USER_SANDBOX_IDLE_TTL_MS) continue;
    await entry.sandbox.dispose().catch(() => {});
    userSandboxes.delete(userId);
    disposed += 1;
  }
  return disposed;
}

export async function disposeUserSandboxes(): Promise<void> {
  for (const entry of userSandboxes.values()) {
    if (!entry.sandbox) continue;
    await entry.sandbox.dispose().catch(() => {});
  }
  userSandboxes.clear();
}

export function getUserSandboxPoolSize(): number {
  return userSandboxes.size;
}

export function setSandboxFactoryForTests(
  factory: typeof initUserSandbox | null
): void {
  sandboxFactory = factory ?? initUserSandbox;
  userSandboxes.clear();
}
