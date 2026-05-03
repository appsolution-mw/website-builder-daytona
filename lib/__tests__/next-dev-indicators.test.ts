import { describe, expect, it } from "vitest";
import {
  ensureNextDevtoolsCssImport,
  ensurePreviewConsoleBridge,
  nextConfigContent,
  nextDevIndicatorsEnabled,
  nextDevtoolsCssContent,
  previewConsoleBridgeContent,
  resolveNextAppConsoleBridgePaths,
  resolveNextConfigPath,
  resolveNextAppDevtoolsPaths,
  staleNextDevtoolsCleanupPaths,
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

  it("writes disabled devIndicators for untyped JavaScript config objects", () => {
    const config = `const nextConfig = {
  images: {},
};

module.exports = nextConfig;
`;

    const updated = setNextDevIndicators(config, false);

    expect(updated).toContain("devIndicators: false,");
    expect(updated).toContain("images: {}");
  });

  it("replaces object devIndicators with disabled devIndicators", () => {
    const updated = setNextDevIndicators(`
const nextConfig = {
  devIndicators: { position: "bottom-right" },
  images: {},
};
`);

    expect(updated.match(/devIndicators:/g)).toHaveLength(1);
    expect(updated).toContain("devIndicators: false,");
    expect(updated).not.toContain("bottom-right");
  });

  it("writes an enabled devIndicators option without duplicating entries", () => {
    const disabled = setNextDevIndicators(baseConfig, false);
    const enabled = setNextDevIndicators(disabled, true);

    expect(enabled).toContain('devIndicators: { position: "bottom-right" },');
    expect(enabled).not.toContain("devIndicators: false");
    expect(enabled.match(/devIndicators:/g)).toHaveLength(1);
  });

  it("resolves supported Next config file names with TypeScript preferred for creation", () => {
    expect(resolveNextConfigPath(["next.config.js"])).toBe("next.config.js");
    expect(resolveNextConfigPath(["next.config.mjs"])).toBe("next.config.mjs");
    expect(resolveNextConfigPath(["next.config.ts"])).toBe("next.config.ts");
    expect(resolveNextConfigPath([])).toBe("next.config.ts");
  });

  it("creates a TypeScript Next config with disabled devIndicators", () => {
    expect(nextConfigContent()).toContain("devIndicators: false,");
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

  it("adds the preview console bridge import and component once", () => {
    const layout = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
    const updated = ensurePreviewConsoleBridge(layout);

    expect(updated).toContain('import WbdPreviewConsoleBridge from "./wbd-preview-console";');
    expect(updated).toContain("<body><WbdPreviewConsoleBridge />{children}</body>");
    expect(ensurePreviewConsoleBridge(updated).match(/WbdPreviewConsoleBridge/g)).toHaveLength(2);
  });

  it("writes a client preview console bridge that posts console events", () => {
    const content = previewConsoleBridgeContent();

    expect(content).toContain('"use client";');
    expect(content).toContain("window.parent.postMessage");
    expect(content).toContain("wbd-preview-console");
    expect(content).toContain("unhandledrejection");
  });

  it("writes css that hides the Next.js devtools portal", () => {
    expect(nextDevtoolsCssContent(false)).toContain("nextjs-portal");
    expect(nextDevtoolsCssContent(true)).not.toContain("display: none");
  });

  it("resolves devtools files inside src/app when that app root exists", () => {
    expect(resolveNextAppDevtoolsPaths(["src/app/layout.tsx"])).toEqual({
      layoutPath: "src/app/layout.tsx",
      cssPath: "src/app/wbd-next-devtools.css",
    });
  });

  it("falls back to app devtools files for root app projects", () => {
    expect(resolveNextAppDevtoolsPaths(["app/layout.tsx"])).toEqual({
      layoutPath: "app/layout.tsx",
      cssPath: "app/wbd-next-devtools.css",
    });
  });

  it("resolves preview console bridge files beside the app layout", () => {
    expect(resolveNextAppConsoleBridgePaths(["src/app/layout.tsx"])).toEqual({
      layoutPath: "src/app/layout.tsx",
      componentPath: "src/app/wbd-preview-console.tsx",
    });
    expect(resolveNextAppConsoleBridgePaths(["app/layout.tsx"])).toEqual({
      layoutPath: "app/layout.tsx",
      componentPath: "app/wbd-preview-console.tsx",
    });
    expect(resolveNextAppConsoleBridgePaths([])).toBeNull();
  });

  it("does not infer an app root before a layout file is known", () => {
    expect(resolveNextAppDevtoolsPaths([])).toBeNull();
    expect(resolveNextAppDevtoolsPaths(["app/wbd-next-devtools.css"])).toBeNull();
  });

  it("identifies stale top-level devtools css when a project uses src/app", () => {
    expect(staleNextDevtoolsCleanupPaths([
      "app/wbd-next-devtools.css",
      "src/app/layout.tsx",
      "src/app/page.tsx",
    ])).toEqual(["app/wbd-next-devtools.css"]);
  });
});
