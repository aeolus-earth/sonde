// Centralized query key factory.
// Structured keys enable precise cache invalidation.

export const queryKeys = {
  experiments: {
    all: (program: string) => ["experiments", program] as const,
    detail: (id: string) => ["experiments", "detail", id] as const,
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
  },
  questions: {
    all: (program: string) => ["questions", program] as const,
    inbox: (program: string) => ["questions", "inbox", program] as const,
  },
  artifacts: {
    byParent: (parentId: string) => ["artifacts", parentId] as const,
  },
  notes: {
    byExperiment: (expId: string) => ["notes", expId] as const,
  },
  activity: {
    recent: (program: string) => ["activity", "recent", program] as const,
    byRecord: (recordId: string) => ["activity", recordId] as const,
  },
  programs: {
    all: () => ["programs"] as const,
  },
} as const;
