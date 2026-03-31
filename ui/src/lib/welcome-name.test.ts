import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { getWelcomeFirstName, getWelcomeGreeting } from "./welcome-name";

function userWith(meta: Record<string, unknown>): User {
  return {
    id: "u1",
    aud: "authenticated",
    role: "authenticated",
    email: "x@aeolus.earth",
    app_metadata: {},
    user_metadata: meta,
    created_at: "",
    updated_at: "",
  } as User;
}

describe("getWelcomeFirstName", () => {
  it("returns null for null user", () => {
    expect(getWelcomeFirstName(null)).toBeNull();
  });

  it("returns first token from full_name", () => {
    expect(getWelcomeFirstName(userWith({ full_name: "Jane Doe" }))).toBe("Jane");
  });

  it("prefers full_name over name", () => {
    expect(
      getWelcomeFirstName(
        userWith({ full_name: "Jane Doe", name: "Other" }),
      ),
    ).toBe("Jane");
  });

  it("uses name when full_name absent", () => {
    expect(getWelcomeFirstName(userWith({ name: "Alex Smith" }))).toBe("Alex");
  });

  it("returns null for empty or whitespace-only strings", () => {
    expect(getWelcomeFirstName(userWith({ full_name: "" }))).toBeNull();
    expect(getWelcomeFirstName(userWith({ full_name: "   " }))).toBeNull();
    expect(getWelcomeFirstName(userWith({ name: "" }))).toBeNull();
  });

  it("ignores non-string metadata", () => {
    expect(
      getWelcomeFirstName(
        userWith({ full_name: 123 as unknown as string, name: "Pat" }),
      ),
    ).toBe("Pat");
  });
});

describe("getWelcomeGreeting", () => {
  it("returns Voyager when no usable name", () => {
    expect(getWelcomeGreeting(null)).toBe("Voyager");
    expect(getWelcomeGreeting(userWith({}))).toBe("Voyager");
  });

  it("returns first name when present", () => {
    expect(getWelcomeGreeting(userWith({ full_name: "Sam" }))).toBe("Sam");
  });
});
