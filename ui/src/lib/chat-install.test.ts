import { describe, expect, it } from "vitest";
import {
  CHAT_INSTALL_STEPS,
  CHAT_INSTALL_VERIFY_COMMANDS,
  sondeGitInstallCommand,
} from "./chat-install";

describe("sondeGitInstallCommand", () => {
  it("installs the CLI from the GitHub repo subdirectory", () => {
    expect(sondeGitInstallCommand()).toBe(
      "uv tool install --force git+https://github.com/aeolus-earth/sonde.git#subdirectory=cli",
    );
  });

  it("supports a caller-provided git ref", () => {
    expect(sondeGitInstallCommand("feature/test")).toBe(
      "uv tool install --force git+https://github.com/aeolus-earth/sonde.git@feature/test#subdirectory=cli",
    );
  });
});

describe("CHAT_INSTALL_STEPS", () => {
  it("copies the required setup commands in order", () => {
    expect(CHAT_INSTALL_STEPS.map((step) => step.command)).toEqual([
      "uv tool install --force git+https://github.com/aeolus-earth/sonde.git#subdirectory=cli",
      "sonde login",
      "sonde setup",
    ]);
  });

  it("includes remote login guidance", () => {
    const loginStep = CHAT_INSTALL_STEPS.find(
      (step) => step.label === "Authenticate",
    );

    expect(loginStep?.hint).toContain("activation code");
  });

  it("does not reference the old wheel download flow", () => {
    for (const step of CHAT_INSTALL_STEPS) {
      expect(step.command).not.toContain("sonde-latest-py3-none-any.whl");
      expect(step.command).not.toContain("releases/latest/download");
    }
  });
});

describe("CHAT_INSTALL_VERIFY_COMMANDS", () => {
  it("lists the binary verification commands in order", () => {
    expect(CHAT_INSTALL_VERIFY_COMMANDS).toEqual([
      "which -a sonde",
      "sonde --version",
      "sonde doctor",
    ]);
  });
});
