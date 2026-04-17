// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccessManagement } from "./access-management";

const useManageableProgramsMock = vi.fn();
const useManageableProgramAccessMock = vi.fn();
const useGrantProgramAccessMock = vi.fn();
const useRevokeProgramAccessMock = vi.fn();
const useBulkGrantProgramAccessMock = vi.fn();

vi.mock("@/hooks/use-admin-access", () => ({
  useManageablePrograms: () => useManageableProgramsMock(),
  useManageableProgramAccess: () => useManageableProgramAccessMock(),
  useGrantProgramAccess: () => useGrantProgramAccessMock(),
  useRevokeProgramAccess: () => useRevokeProgramAccessMock(),
  useBulkGrantProgramAccess: () => useBulkGrantProgramAccessMock(),
}));

const programs = [
  {
    id: "alpha",
    name: "Alpha Library",
    description: null,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "beta",
    name: "Beta Library",
    description: null,
    created_at: "2026-04-01T00:00:00Z",
  },
];

describe("AdminAccessManagement", () => {
  const grantMutate = vi.fn();
  const revokeMutate = vi.fn();
  const bulkMutate = vi.fn();

  beforeEach(() => {
    grantMutate.mockReset();
    revokeMutate.mockReset();
    bulkMutate.mockReset();
    useManageableProgramsMock.mockReturnValue({
      data: programs,
      isLoading: false,
      error: null,
    });
    useManageableProgramAccessMock.mockReturnValue({
      data: [
        {
          email: "alice@aeolus.earth",
          user_id: "user-1",
          program: "alpha",
          role: "admin",
          status: "active",
          granted_at: "2026-04-01T00:00:00Z",
          applied_at: "2026-04-01T00:01:00Z",
        },
      ],
      isLoading: false,
      error: null,
    });
    useGrantProgramAccessMock.mockReturnValue({
      mutate: grantMutate,
      isPending: false,
    });
    useRevokeProgramAccessMock.mockReturnValue({
      mutate: revokeMutate,
      isPending: false,
    });
    useBulkGrantProgramAccessMock.mockReturnValue({
      mutate: bulkMutate,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the user/program access matrix", () => {
    render(createElement(AdminAccessManagement));

    expect(screen.getByText("Access management")).toBeVisible();
    expect(screen.getByText("alice@aeolus.earth")).toBeVisible();
    expect(screen.getAllByText("Alpha Library").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta Library").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Grant" })).toBeVisible();
  });

  it("previews and applies bulk FTE contributor grants", () => {
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByPlaceholderText(/alice@aeolus/i), {
      target: {
        value: "alice@aeolus.earth bob@aeolus.earth",
      },
    });

    expect(screen.getByText("2 valid emails")).toBeVisible();
    expect(screen.getByText("3 grants to add")).toBeVisible();
    expect(screen.getByText("1 already covered")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Apply FTE grants" }));

    expect(bulkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["alice@aeolus.earth", "bob@aeolus.earth"],
        programs,
        role: "contributor",
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("blocks invalid non-Aeolus emails before bulk writes", () => {
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByPlaceholderText(/alice@aeolus/i), {
      target: {
        value: "contractor@example.com",
      },
    });

    expect(screen.getByText("Invalid entries: contractor@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply FTE grants" })).toBeDisabled();
  });
});
