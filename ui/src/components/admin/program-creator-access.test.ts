// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramCreatorAccess } from "./program-creator-access";

const useProgramCreatorsMock = vi.fn();
const useProgramCreatorEventsMock = vi.fn();
const useGrantProgramCreatorMock = vi.fn();
const useRevokeProgramCreatorMock = vi.fn();
const useBulkGrantProgramCreatorsMock = vi.fn();

vi.mock("@/hooks/use-admin-access", () => ({
  useProgramCreators: () => useProgramCreatorsMock(),
  useProgramCreatorEvents: (filters: unknown) => useProgramCreatorEventsMock(filters),
  useGrantProgramCreator: () => useGrantProgramCreatorMock(),
  useRevokeProgramCreator: () => useRevokeProgramCreatorMock(),
  useBulkGrantProgramCreators: () => useBulkGrantProgramCreatorsMock(),
}));

const creators = [
  {
    email: "alice@aeolus.earth",
    granted_by_email: "root@aeolus.earth",
    granted_at: "2026-04-01T00:00:00Z",
  },
  {
    email: "bob@aeolus.earth",
    granted_by_email: null,
    granted_at: "2026-04-02T00:00:00Z",
  },
];

const creatorEvents = [
  {
    id: 1,
    action: "grant",
    actor_email: "root@aeolus.earth",
    target_email: "alice@aeolus.earth",
    details: {},
    created_at: "2026-04-03T00:00:00Z",
  },
  {
    id: 2,
    action: "revoke",
    actor_email: "root@aeolus.earth",
    target_email: "bob@aeolus.earth",
    details: {},
    created_at: "2026-04-04T00:00:00Z",
  },
];

describe("ProgramCreatorAccess", () => {
  const grantMutate = vi.fn();
  const revokeMutate = vi.fn();
  const bulkMutate = vi.fn();
  let confirmMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    grantMutate.mockReset();
    revokeMutate.mockReset();
    bulkMutate.mockReset();
    confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    useProgramCreatorsMock.mockReturnValue({
      data: creators,
      isLoading: false,
      error: null,
    });
    useProgramCreatorEventsMock.mockReturnValue({
      data: creatorEvents,
      isLoading: false,
      error: null,
    });
    useGrantProgramCreatorMock.mockReturnValue({
      mutate: grantMutate,
      isPending: false,
    });
    useRevokeProgramCreatorMock.mockReturnValue({
      mutate: revokeMutate,
      isPending: false,
    });
    useBulkGrantProgramCreatorsMock.mockReturnValue({
      mutate: bulkMutate,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    confirmMock.mockRestore();
  });

  it("renders the allowlist and recent changes", () => {
    render(createElement(ProgramCreatorAccess));

    expect(screen.getByText("Program creation access")).toBeVisible();
    expect(screen.getAllByText("alice@aeolus.earth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bob@aeolus.earth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Granted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Grant creator access" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply allowlist" })).toBeVisible();
  });

  it("grants single creator access", () => {
    render(createElement(ProgramCreatorAccess));

    fireEvent.change(screen.getByPlaceholderText("person@aeolus.earth"), {
      target: { value: "lead@aeolus.earth" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant creator access" }));

    expect(grantMutate).toHaveBeenCalledWith(
      { email: "lead@aeolus.earth" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("previews and applies the bulk allowlist", () => {
    render(createElement(ProgramCreatorAccess));

    fireEvent.change(screen.getByPlaceholderText(/alice@aeolus/i), {
      target: {
        value: "alice@aeolus.earth bob@aeolus.earth carol@aeolus.earth",
      },
    });

    expect(screen.getByText("3 valid emails")).toBeVisible();
    expect(screen.getByText("1 new grants")).toBeVisible();
    expect(screen.getByText("2 already allowlisted")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Apply allowlist" }));

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("Add 1 program creator(s)"),
    );
    expect(bulkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["alice@aeolus.earth", "bob@aeolus.earth", "carol@aeolus.earth"],
        creators,
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("revokes creator access from the allowlist", () => {
    render(createElement(ProgramCreatorAccess));

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("Revoke program creation access for alice@aeolus.earth"),
    );
    expect(revokeMutate).toHaveBeenCalledWith({ email: "alice@aeolus.earth" });
  });

  it("blocks invalid creator emails before bulk writes", () => {
    render(createElement(ProgramCreatorAccess));

    fireEvent.change(screen.getByPlaceholderText(/alice@aeolus/i), {
      target: {
        value: "contractor@example.com",
      },
    });

    expect(screen.getByText("Invalid entries: contractor@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply allowlist" })).toBeDisabled();
  });
});
