import { create } from "zustand";
import type { GitHubAuthMode, GitHubRateLimit } from "@/types/github";

interface GitHubRateLimitState extends GitHubRateLimit {
  authMode: GitHubAuthMode | "unknown";
  lastUpdated: number;
  update: (rl: GitHubRateLimit, authMode?: GitHubAuthMode) => void;
}

export const useGitHubRateLimitStore = create<GitHubRateLimitState>((set) => ({
  limit: 60,
  remaining: 60,
  reset: 0,
  used: 0,
  authMode: "unknown",
  lastUpdated: 0,
  update: (rl, authMode) =>
    set((state) => ({
      ...rl,
      authMode: authMode ?? state.authMode,
      lastUpdated: Date.now(),
    })),
}));

export const useGitHubRateRemaining = () =>
  useGitHubRateLimitStore((s) => s.remaining);
export const useGitHubRateReset = () =>
  useGitHubRateLimitStore((s) => s.reset);
export const useGitHubRateLimitValue = () =>
  useGitHubRateLimitStore((s) => s.limit);
export const useGitHubAuthMode = () =>
  useGitHubRateLimitStore((s) => s.authMode);
