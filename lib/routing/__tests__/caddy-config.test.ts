import { describe, expect, it } from "vitest";
import { buildProjectPreviewRoute } from "../caddy-config";

describe("buildProjectPreviewRoute", () => {
  it("builds a Caddy route matching the hostname and proxying to the target", () => {
    expect(
      buildProjectPreviewRoute({
        hostname: "preview.example.com",
        targetHost: "10.0.0.12",
        targetPort: 3000,
      }),
    ).toEqual({
      match: [{ host: ["preview.example.com"] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: "10.0.0.12:3000" }],
        },
      ],
      terminal: true,
    });
  });
});
