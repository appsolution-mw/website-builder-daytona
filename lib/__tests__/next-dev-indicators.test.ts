import { describe, expect, it } from "vitest";
import {
  ensureNextDevtoolsCssImport,
  nextDevIndicatorsEnabled,
  nextDevtoolsCssContent,
  setNextDevIndicators,
} from "../next-dev-indicators";

const baseConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*"],
};

export default nextConfig;
`;

describe("next dev indicators config", () => {
  it("detects the indicator as enabled unless explicitly disabled", () => {
    expect(nextDevIndicatorsEnabled(baseConfig)).toBe(true);
    expect(nextDevIndicatorsEnabled(setNextDevIndicators(baseConfig, false))).toBe(false);
  });

  it("writes a disabled devIndicators option", () => {
    expect(setNextDevIndicators(baseConfig, false)).toContain("devIndicators: false,");
  });

  it("writes an enabled devIndicators option without duplicating entries", () => {
    const disabled = setNextDevIndicators(baseConfig, false);
    const enabled = setNextDevIndicators(disabled, true);

    expect(enabled).toContain('devIndicators: { position: "bottom-right" },');
    expect(enabled).not.toContain("devIndicators: false");
    expect(enabled.match(/devIndicators:/g)).toHaveLength(1);
  });

  it("adds the preview devtools css import once", () => {
    const layout = `export default function RootLayout() {
  return <html><body /></html>;
}
`;
    const updated = ensureNextDevtoolsCssImport(layout);

    expect(updated).toContain('import "./wbd-next-devtools.css";');
    expect(ensureNextDevtoolsCssImport(updated).match(/wbd-next-devtools\.css/g)).toHaveLength(1);
  });

  it("writes css that hides the Next.js devtools portal", () => {
    expect(nextDevtoolsCssContent(false)).toContain("nextjs-portal");
    expect(nextDevtoolsCssContent(true)).not.toContain("display: none");
  });
});
