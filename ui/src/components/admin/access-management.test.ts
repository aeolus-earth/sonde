// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccessManagement } from "./access-management";

const useManageableProgramsMock = vi.fn();
const useManageableProgramAccessMock = vi.fn();
const useProgramAccessEventsMock = vi.fn();
const useGrantProgramAccessMock = vi.fn();
const useRevokeProgramAccessMock = vi.fn();
const useOffboardProgramAccessMock = vi.fn();
const useBulkGrantProgramAccessMock = vi.fn();

vi.mock("@/hooks/use-admin-access", () => ({
  useManageablePrograms: () => useManageableProgramsMock(),
  useManageableProgramAccess: () => useManageableProgramAccessMock(),
  useProgramAccessEvents: (filters: unknown) => useProgramAccessEventsMock(filters),
  useGrantProgramAccess: () => useGrantProgramAccessMock(),
  useRevokeProgramAccess: () => useRevokeProgramAccessMock(),
  useOffboardProgramAccess: () => useOffboardProgramAccessMock(),
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

const accessEvents = [
  {
    id: 1,
    action: "grant",
    actor_email: "root@aeolus.earth",
    target_email: "alice@aeolus.earth",
    program: "alpha",
    old_role: null,
    new_role: "admin",
    details: { status: "active" },
    created_at: "2026-04-03T00:00:00Z",
  },
  {
    id: 2,
    action: "revoke",
    actor_email: "root@aeolus.earth",
    target_email: "bob@aeolus.earth",
    program: "beta",
    old_role: "contributor",
    new_role: null,
    details: {},
    created_at: "2026-04-02T00:00:00Z",
  },
  {
    id: 3,
    action: "apply_pending",
    actor_email: null,
    target_email: "carol@aeolus.earth",
    program: "alpha",
    old_role: null,
    new_role: "contributor",
    details: { source: "auth.users trigger" },
    created_at: "2026-04-01T00:00:00Z",
  },
];

const activeAccessRow = {
  email: "alice@aeolus.earth",
  user_id: "user-1",
  program: "alpha",
  role: "admin",
  status: "active",
  granted_at: "2026-04-01T00:00:00Z",
  applied_at: "2026-04-01T00:01:00Z",
  expires_at: null,
};

describe("AdminAccessManagement", () => {
  const grantMutate = vi.fn();
  const revokeMutate = vi.fn();
  const offboardMutate = vi.fn();
  const bulkMutate = vi.fn();
  let confirmMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    grantMutate.mockReset();
    revokeMutate.mockReset();
    offboardMutate.mockReset();
    bulkMutate.mockReset();
    confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    useManageableProgramsMock.mockReturnValue({
      data: programs,
      isLoading: false,
      error: null,
    });
    useManageableProgramAccessMock.mockReturnValue({
      data: [activeAccessRow],
      isLoading: false,
      error: null,
    });
    useProgramAccessEventsMock.mockImplementation(
      ({
        action,
        program,
      }: {
        action?: string;
        program?: string;
      } = {}) => ({
        data: accessEvents.filter(
          (event) =>
            (!action || event.action === action) &&
            (!program || event.program === program),
        ),
        isLoading: false,
        error: null,
      }),
    );
    useGrantProgramAccessMock.mockReturnValue({
      mutate: grantMutate,
      isPending: false,
    });
    useRevokeProgramAccessMock.mockReturnValue({
      mutate: revokeMutate,
      isPending: false,
    });
    useOffboardProgramAccessMock.mockReturnValue({
      mutate: offboardMutate,
      isPending: false,
    });
    useBulkGrantProgramAccessMock.mockReturnValue({
      mutate: bulkMutate,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    confirmMock.mockRestore();
  });

  it("renders the user/program access matrix", () => {
    render(createElement(AdminAccessManagement));

    expect(screen.getByText("Access management")).toBeVisible();
    const matrixPanel = screen.getByRole("heading", { name: "User access matrix" })
      .parentElement?.parentElement?.parentElement;

    expect(matrixPanel).toBeTruthy();
    expect(within(matrixPanel!).getByText("alice@aeolus.earth")).toBeVisible();
    expect(screen.getAllByText("Alpha Library").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta Library").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Grant" })).toBeVisible();
    expect(screen.getByText("Recent access changes")).toBeVisible();
    expect(screen.getByText("bob@aeolus.earth")).toBeVisible();
  });

  it("previews, confirms, and applies bulk FTE contributor grants without expiry", () => {
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

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("add 3 contributor grants"),
    );
    expect(bulkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["alice@aeolus.earth", "bob@aeolus.earth"],
        programs,
        role: "contributor",
        expiresAt: null,
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("does not apply bulk FTE grants when confirmation is cancelled", () => {
    confirmMock.mockReturnValue(false);
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByPlaceholderText(/alice@aeolus/i), {
      target: {
        value: "alice@aeolus.earth bob@aeolus.earth",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply FTE grants" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(bulkMutate).not.toHaveBeenCalled();
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

  it("filters users by pending access", () => {
    useManageableProgramAccessMock.mockReturnValue({
      data: [
        activeAccessRow,
        {
          email: "carol@aeolus.earth",
          user_id: null,
          program: "beta",
          role: "contributor",
          status: "pending",
          granted_at: "2026-04-02T00:00:00Z",
          applied_at: null,
          expires_at: "2026-07-01T00:00:00Z",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByLabelText("Filter users by access status"), {
      target: { value: "pending" },
    });

    const matrixPanel = screen.getByRole("heading", { name: "User access matrix" })
      .parentElement?.parentElement?.parentElement;

    expect(matrixPanel).toBeTruthy();
    expect(within(matrixPanel!).queryByText("alice@aeolus.earth")).not.toBeInTheDocument();
    expect(within(matrixPanel!).getByText("carol@aeolus.earth")).toBeVisible();
  });

  it("grants scoped contractor access with a 90-day expiry", () => {
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByPlaceholderText("person@aeolus.earth"), {
      target: { value: "contractor@aeolus.earth" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant scoped access" }));

    expect(bulkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["contractor@aeolus.earth"],
        programs: [programs[0]],
        role: "contributor",
        expiresAt: expect.any(String),
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("shows expired grants and can renew them", () => {
    useManageableProgramAccessMock.mockReturnValue({
      data: [
        {
          email: "dana@aeolus.earth",
          user_id: "user-2",
          program: "alpha",
          role: "contributor",
          status: "expired",
          granted_at: "2026-01-01T00:00:00Z",
          applied_at: "2026-01-01T00:01:00Z",
          expires_at: "2026-02-01T00:00:00Z",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByLabelText("Filter users by access status"), {
      target: { value: "expired" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Renew 90d" }));

    expect(screen.getByText("dana@aeolus.earth")).toBeVisible();
    expect(grantMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "dana@aeolus.earth",
        program: "alpha",
        expiresAt: expect.any(String),
      }),
    );
  });

  it("offboards a user from manageable programs", () => {
    render(createElement(AdminAccessManagement));

    fireEvent.click(screen.getByRole("button", { name: "Offboard" }));

    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("alice@aeolus.earth"));
    expect(offboardMutate).toHaveBeenCalledWith({ email: "alice@aeolus.earth" });
  });

  it("filters recent access changes by action and program", () => {
    render(createElement(AdminAccessManagement));

    fireEvent.change(screen.getByLabelText("Filter access changes by action"), {
      target: { value: "revoke" },
    });
    fireEvent.change(screen.getByLabelText("Filter access changes by program"), {
      target: { value: "beta" },
    });

    const auditPanel = screen.getByRole("heading", { name: "Recent access changes" })
      .parentElement?.parentElement?.parentElement;

    expect(auditPanel).toBeTruthy();
    expect(within(auditPanel!).getByText("bob@aeolus.earth")).toBeVisible();
    expect(within(auditPanel!).queryByText("alice@aeolus.earth")).not.toBeInTheDocument();
    expect(within(auditPanel!).queryByText("carol@aeolus.earth")).not.toBeInTheDocument();
  });
});
