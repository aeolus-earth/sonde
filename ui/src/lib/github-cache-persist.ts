import type { QueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "sonde-github-cache";
const DEBOUNCE_MS = 2000;

export function setupGitHubCachePersistence(queryClient: QueryClient) {
  // Hydrate on startup
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const entries = JSON.parse(stored) as Array<{
        queryKey: readonly unknown[];
        data: unknown;
        dataUpdatedAt: number;
      }>;
      for (const { queryKey, data, dataUpdatedAt } of entries) {
        queryClient.setQueryData(queryKey, data, { updatedAt: dataUpdatedAt });
      }
    }
  } catch {
    // Corrupt or private mode — ignore
  }

  // Persist on changes (debounced)
  let timer: ReturnType<typeof setTimeout>;
  queryClient.getQueryCache().subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const queries = queryClient.getQueryCache().findAll({
        queryKey: ["github"],
      });
      const entries = queries
        .filter((q) => q.state.data != null)
        .map((q) => ({
          queryKey: q.queryKey,
          data: q.state.data,
          dataUpdatedAt: q.state.dataUpdatedAt,
        }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      } catch {
        // Quota exceeded — acceptable
      }
    }, DEBOUNCE_MS);
  });
}
