const DEV_INDICATORS_DISABLED_RE = /\n\s*devIndicators:\s*false\s*,?/;
const DEV_INDICATORS_ENABLED_RE =
  /\n\s*devIndicators:\s*\{\s*position:\s*["']bottom-right["']\s*,?\s*\}\s*,?/;
const DEVTOOLS_CSS_IMPORT = 'import "./wbd-next-devtools.css";';
const APP_LAYOUT_PATH = "app/layout.tsx";
const SRC_APP_LAYOUT_PATH = "src/app/layout.tsx";
const APP_DEVTOOLS_CSS_PATH = "app/wbd-next-devtools.css";
const SRC_APP_DEVTOOLS_CSS_PATH = "src/app/wbd-next-devtools.css";
const DEVTOOLS_HIDE_CSS = `nextjs-portal,
script[data-nextjs-dev-overlay="true"] {
  display: none !important;
  pointer-events: none !important;
}
`;

export type NextAppDevtoolsPaths = {
  layoutPath: string;
  cssPath: string;
};

export function nextDevIndicatorsEnabled(config: string): boolean {
  return !DEV_INDICATORS_DISABLED_RE.test(config);
}

export function setNextDevIndicators(config: string, enabled: boolean): string {
  const clean = config
    .replace(DEV_INDICATORS_DISABLED_RE, "")
    .replace(DEV_INDICATORS_ENABLED_RE, "");
  const insert = enabled
    ? '\n  devIndicators: { position: "bottom-right" },'
    : "\n  devIndicators: false,";

  return clean.replace(/const nextConfig: NextConfig = \{/, (match) => `${match}${insert}`);
}

export function ensureNextDevtoolsCssImport(layout: string): string {
  if (layout.includes(DEVTOOLS_CSS_IMPORT)) return layout;

  const lines = layout.split("\n");
  let insertAt = 0;
  while (/^\s*["']use client["'];?\s*$/.test(lines[insertAt] ?? "")) insertAt++;
  while (/^\s*import\s/.test(lines[insertAt] ?? "")) insertAt++;
  lines.splice(insertAt, 0, DEVTOOLS_CSS_IMPORT);
  return lines.join("\n");
}

export function nextDevtoolsCssContent(enabled: boolean): string {
  return enabled ? "/* Website Builder: Next.js DevTools visible. */\n" : DEVTOOLS_HIDE_CSS;
}

export function resolveNextAppDevtoolsPaths(paths: readonly string[]): NextAppDevtoolsPaths {
  if (paths.includes(SRC_APP_LAYOUT_PATH)) {
    return {
      layoutPath: SRC_APP_LAYOUT_PATH,
      cssPath: SRC_APP_DEVTOOLS_CSS_PATH,
    };
  }

  return {
    layoutPath: APP_LAYOUT_PATH,
    cssPath: APP_DEVTOOLS_CSS_PATH,
  };
}
