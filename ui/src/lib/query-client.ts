import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — fresh enough for a research dashboard
      gcTime: 5 * 60_000, // 5min — keep unused data in cache before GC
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
