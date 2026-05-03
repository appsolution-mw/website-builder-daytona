import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("host next config", () => {
  it("hides the host dev indicator so project previews do not show duplicate Next.js devtools", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });
});
