import { describe, expect, it } from "vitest";
import {
  readTimelineRepoIdentity,
  type TimelineProxyResponse,
} from "./timeline-proxy-response";

function createResponse(
  overrides?: Partial<TimelineProxyResponse>,
): TimelineProxyResponse {
  return {
    commits: [{ sha: "abc123" }],
    repo: {
      defaultBranch: "main",
      htmlUrl: "https://github.com/aeolus-earth/sonde",
      private: false,
    },
    diagnostics: {
      authMode: "server_token",
      upstreamRequests: 1,
    },
    ...overrides,
  };
}

describe("readTimelineRepoIdentity", () => {
  it("prefers explicit owner and repo fields when present", () => {
    const identity = readTimelineRepoIdentity(
      createResponse({
        repo: {
          owner: "aeolus-earth",
          repo: "sonde",
          htmlUrl: "https://github.com/other/repo",
        },
      }),
    );

    expect(identity).toEqual({
      owner: "aeolus-earth",
      repo: "sonde",
    });
  });

  it("parses the repo identity from htmlUrl when owner and repo are absent", () => {
    const identity = readTimelineRepoIdentity(createResponse());

    expect(identity).toEqual({
      owner: "aeolus-earth",
      repo: "sonde",
    });
  });

  it("returns null when the response does not include a usable repo identity", () => {
    const identity = readTimelineRepoIdentity(
      createResponse({
        repo: {
          defaultBranch: "main",
          htmlUrl: "not-a-url",
        },
      }),
    );

    expect(identity).toBeNull();
  });
});
