// Centralized query key factory.
// Structured keys enable precise cache invalidation.

export const queryKeys = {
  experiments: {
    all: (program: string) => ["experiments", program] as const,
    byProgram: (program: string) => ["experiments", "byProgram", program] as const,
    detail: (id: string) => ["experiments", "detail", id] as const,
    ancestors: (id: string) => ["experiments", "ancestors", id] as const,
    children: (id: string) => ["experiments", "children", id] as const,
    tree: (rootId: string) => ["experiments", "tree", rootId] as const,
    search: (program: string, q: string) =>
      ["experiments", "search", program, q] as const,
  },
  findings: {
    all: (program: string) => ["findings", program] as const,
    current: (program: string) => ["findings", "current", program] as const,
    detail: (id: string) => ["findings", "detail", id] as const,
  },
  directions: {
    all: (program: string) => ["directions", program] as const,
    detail: (id: string) => ["directions", "detail", id] as const,
    status: (program: string) => ["directions", "status", program] as const,
    children: (parentId: string) => ["directions", "children", parentId] as const,
  },
  questions: {
    all: (program: string) => ["questions", program] as const,
    inbox: (program: string) => ["questions", "inbox", program] as const,
  },
  artifacts: {
    byParent: (parentId: string) => ["artifacts", parentId] as const,
    detail: (artifactId: string) => ["artifacts", "detail", artifactId] as const,
    blob: (storagePath: string | null) => ["artifacts", "blob", storagePath] as const,
  },
  notes: {
    byRecord: (type: string, id: string) => ["notes", type, id] as const,
    byExperiment: (expId: string) => ["notes", "experiment", expId] as const,
    search: (expId: string, q: string) => ["notes", "search", expId, q] as const,
  },
  activity: {
    recent: (program: string) => ["activity", "recent", program] as const,
    byRecord: (recordId: string) => ["activity", recordId] as const,
  },
  projects: {
    all: (program: string) => ["projects", program] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
    status: (program: string) => ["projects", "status", program] as const,
  },
  programs: {
    all: () => ["programs"] as const,
  },
  programTakeaways: {
    byProgram: (program: string) => ["programTakeaways", program] as const,
  },
  github: {
    allCommits: (owner: string, repo: string, branch: string) =>
      ["github", "commits", owner, repo, branch] as const,
  },
} as const;
