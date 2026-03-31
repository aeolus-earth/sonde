import { describe, expect, it } from "vitest";
import {
  expandDefendExistenceCommand,
  getDefendMyExistenceCompletion,
  isDefendExistenceCommand,
} from "./defend-existence";

describe("expandDefendExistenceCommand", () => {
  it("returns null for unrelated text", () => {
    expect(expandDefendExistenceCommand("hello")).toBeNull();
    expect(expandDefendExistenceCommand("prefix /defend-my-existence")).toBeNull();
  });

  it("expands bare command (case-insensitive, trimmed)", () => {
    const a = expandDefendExistenceCommand("/defend-my-existence");
    const b = expandDefendExistenceCommand("  /DEFEND-MY-EXISTENCE  ");
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(a).toContain("Sonde / Aeolus CLI");
    expect(a).toContain("Your task (UI command: /defend-my-existence)");
    expect(a).toContain("Linear");
    expect(a).toContain("sonde log");
  });

  it("appends follow-up text after the command", () => {
    const out = expandDefendExistenceCommand(
      "/defend-my-existence isn't this just Notion?"
    );
    expect(out).not.toBeNull();
    expect(out).toContain("User follow-up (after the command)");
    expect(out).toContain("isn't this just Notion?");
  });
});

describe("isDefendExistenceCommand", () => {
  it("matches only when the trimmed message starts with the command", () => {
    expect(isDefendExistenceCommand("/defend-my-existence")).toBe(true);
    expect(isDefendExistenceCommand("  /defend-my-existence  ")).toBe(true);
    expect(isDefendExistenceCommand("/DEFEND-MY-EXISTENCE extra")).toBe(true);
    expect(isDefendExistenceCommand("say /defend-my-existence")).toBe(false);
  });
});

describe("getDefendMyExistenceCompletion", () => {
  it("returns null when not a prefix of the command", () => {
    expect(getDefendMyExistenceCompletion("hello", 5)).toBeNull();
    expect(getDefendMyExistenceCompletion("/other", 6)).toBeNull();
  });

  it("completes slash-prefixed token with ghost suffix", () => {
    const v = "/defend-my";
    const r = getDefendMyExistenceCompletion(v, v.length);
    expect(r).not.toBeNull();
    expect(r!.ghostSuffix).toBe("-existence");
    expect(r!.start).toBe(0);
    expect(r!.end).toBe(v.length);
  });

  it("matches defend-my- without leading slash (hint only, no ghost)", () => {
    const v = "defend-my-";
    const r = getDefendMyExistenceCompletion(v, v.length);
    expect(r).not.toBeNull();
    expect(r!.ghostSuffix).toBeNull();
  });
});
