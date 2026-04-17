// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramSwitcher } from "./program-switcher";

const useProgramsMock = vi.fn();
const useActiveProgramMock = vi.fn();
const useSetActiveProgramMock = vi.fn();

vi.mock("@/hooks/use-programs", () => ({
  usePrograms: () => useProgramsMock(),
}));

vi.mock("@/stores/program", () => ({
  useActiveProgram: () => useActiveProgramMock(),
  useSetActiveProgram: () => useSetActiveProgramMock(),
}));

describe("ProgramSwitcher", () => {
  beforeEach(() => {
    useActiveProgramMock.mockReturnValue("");
    useSetActiveProgramMock.mockReturnValue(vi.fn());
  });

  it("shows an explicit no-access label when no programs are visible", () => {
    useProgramsMock.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(createElement(ProgramSwitcher));

    const button = screen.getByRole("button", { name: /no programs/i });
    expect(button).toBeDisabled();
  });
});
