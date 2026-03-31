import { create } from "zustand";
import type { GitHubRateLimit } from "@/types/github";

interface GitHubRateLimitState extends GitHubRateLimit {
  lastUpdated: number;
  update: (rl: GitHubRateLimit) => void;
}

export const useGitHubRateLimitStore = create<GitHubRateLimitState>((set) => ({
  limit: 60,
  remaining: 60,
  reset: 0,
  used: 0,
  lastUpdated: 0,
  update: (rl) => set({ ...rl, lastUpdated: Date.now() }),
}));

export const useGitHubRateRemaining = () =>
  useGitHubRateLimitStore((s) => s.remaining);
export const useGitHubRateReset = () =>
  useGitHubRateLimitStore((s) => s.reset);
export const useGitHubRateLimitValue = () =>
  useGitHubRateLimitStore((s) => s.limit);
