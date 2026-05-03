import { describe, expect, it } from "vitest";

describe("Better Auth route", () => {
  it("exports GET and POST handlers", async () => {
    process.env.DATABASE_URL = "postgresql://wbd:wbd_dev@localhost:5433/wbd_test";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.GITHUB_OAUTH_CLIENT_ID = "github-client-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "github-client-secret";

    const route = await import("../[...all]/route");

    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
  });
});
