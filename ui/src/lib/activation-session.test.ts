import { describe, expect, it, vi } from "vitest";
import { ACTIVATION_STORAGE_KEY, clearActivationStorage } from "./activation-session";

describe("activation session cleanup", () => {
  it("clears only local activation storage entries", () => {
    const storage = {
      removeItem: vi.fn(),
    };

    clearActivationStorage(storage);

    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVATION_STORAGE_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(
      `${ACTIVATION_STORAGE_KEY}-code-verifier`
    );
  });
});
