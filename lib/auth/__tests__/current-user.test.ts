import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => null),
    },
  },
}));

describe("current user helpers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the explicit dev user fallback outside production", async () => {
    process.env.DEV_USER_ID = "dev-user";
    process.env.NODE_ENV = "test";

    const { currentUserFromHeaders } = await import("../current-user");
    const user = await currentUserFromHeaders(new Headers());

    expect(user?.id).toBe("dev-user");
  });

  it("does not use the dev user fallback in production by default", async () => {
    process.env.DEV_USER_ID = "dev-user";
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEV_USER_FALLBACK;

    vi.resetModules();
    const { currentUserFromHeaders } = await import("../current-user");
    const user = await currentUserFromHeaders(new Headers());

    expect(user).toBeNull();
  });

  it("requires explicit admin identity in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_USER_IDS = "admin-user";

    vi.resetModules();
    const { isAdminUser } = await import("../current-user");

    expect(isAdminUser({ id: "admin-user" })).toBe(true);
    expect(isAdminUser({ id: "other-user" })).toBe(false);
  });
});
