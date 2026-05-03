const DEV_INDICATORS_RE = /\n\s*devIndicators:\s*(?:false|\{[^}]*\})\s*,?/g;
const NEXT_CONFIG_OBJECT_RE = /(const\s+nextConfig(?:\s*:\s*NextConfig)?\s*=\s*\{)/;
const DEVTOOLS_CSS_IMPORT = 'import "./wbd-next-devtools.css";';
const PREVIEW_CONSOLE_IMPORT = 'import WbdPreviewConsoleBridge from "./wbd-preview-console";';
const NEXT_CONFIG_TS_PATH = "next.config.ts";
const NEXT_CONFIG_MJS_PATH = "next.config.mjs";
const NEXT_CONFIG_JS_PATH = "next.config.js";
const APP_LAYOUT_PATH = "app/layout.tsx";
const SRC_APP_LAYOUT_PATH = "src/app/layout.tsx";
const APP_DEVTOOLS_CSS_PATH = "app/wbd-next-devtools.css";
const SRC_APP_DEVTOOLS_CSS_PATH = "src/app/wbd-next-devtools.css";
const APP_PREVIEW_CONSOLE_PATH = "app/wbd-preview-console.tsx";
const SRC_APP_PREVIEW_CONSOLE_PATH = "src/app/wbd-preview-console.tsx";
const SUPPORTED_NEXT_CONFIG_PATHS = [
  NEXT_CONFIG_TS_PATH,
  NEXT_CONFIG_MJS_PATH,
  NEXT_CONFIG_JS_PATH,
] as const;
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

export type NextAppConsoleBridgePaths = {
  layoutPath: string;
  componentPath: string;
};

export function nextDevIndicatorsEnabled(config: string): boolean {
  return !/\n\s*devIndicators:\s*false\s*,?/.test(config);
}

export function setNextDevIndicators(config: string, enabled: boolean): string {
  const clean = config.replace(DEV_INDICATORS_RE, "");
  const insert = enabled
    ? '\n  devIndicators: { position: "bottom-right" },'
    : "\n  devIndicators: false,";

  return clean.replace(NEXT_CONFIG_OBJECT_RE, (match) => `${match}${insert}`);
}

export function resolveNextConfigPath(paths: readonly string[]): string {
  return SUPPORTED_NEXT_CONFIG_PATHS.find((path) => paths.includes(path)) ?? NEXT_CONFIG_TS_PATH;
}

export function nextConfigContent(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
`;
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

function addImportOnce(source: string, importLine: string): string {
  if (source.includes(importLine)) return source;

  const lines = source.split("\n");
  let insertAt = 0;
  while (/^\s*["']use client["'];?\s*$/.test(lines[insertAt] ?? "")) insertAt++;
  while (/^\s*import\s/.test(lines[insertAt] ?? "")) insertAt++;
  lines.splice(insertAt, 0, importLine);
  return lines.join("\n");
}

export function ensurePreviewConsoleBridge(layout: string): string {
  const next = addImportOnce(layout, PREVIEW_CONSOLE_IMPORT);
  if (next.includes("<WbdPreviewConsoleBridge />")) return next;
  return next.replace(/(<body\b[^>]*>)/, "$1<WbdPreviewConsoleBridge />");
}

export function nextDevtoolsCssContent(enabled: boolean): string {
  return enabled ? "/* Website Builder: Next.js DevTools visible. */\n" : DEVTOOLS_HIDE_CSS;
}

export function resolveNextAppDevtoolsPaths(paths: readonly string[]): NextAppDevtoolsPaths | null {
  if (paths.includes(SRC_APP_LAYOUT_PATH)) {
    return {
      layoutPath: SRC_APP_LAYOUT_PATH,
      cssPath: SRC_APP_DEVTOOLS_CSS_PATH,
    };
  }

  if (paths.includes(APP_LAYOUT_PATH)) {
    return {
      layoutPath: APP_LAYOUT_PATH,
      cssPath: APP_DEVTOOLS_CSS_PATH,
    };
  }

  return null;
}

export function resolveNextAppConsoleBridgePaths(
  paths: readonly string[],
): NextAppConsoleBridgePaths | null {
  if (paths.includes(SRC_APP_LAYOUT_PATH)) {
    return {
      layoutPath: SRC_APP_LAYOUT_PATH,
      componentPath: SRC_APP_PREVIEW_CONSOLE_PATH,
    };
  }

  if (paths.includes(APP_LAYOUT_PATH)) {
    return {
      layoutPath: APP_LAYOUT_PATH,
      componentPath: APP_PREVIEW_CONSOLE_PATH,
    };
  }

  return null;
}

export function previewConsoleBridgeContent(): string {
  return `"use client";

import { useEffect } from "react";

const MESSAGE_TYPE = "wbd-preview-console";
const MAX_SERIALIZED_LENGTH = 2000;

type ConsoleLevel = "log" | "info" | "warn" | "error";

function serializeValue(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clip(value: string): string {
  if (value.length <= MAX_SERIALIZED_LENGTH) return value;
  return value.slice(0, MAX_SERIALIZED_LENGTH) + "…";
}

function post(level: ConsoleLevel, values: unknown[]): void {
  window.parent.postMessage({
    type: MESSAGE_TYPE,
    level,
    values: values.map((value) => clip(serializeValue(value))),
    timestamp: Date.now(),
    url: window.location.href,
  }, "*");
}

export default function WbdPreviewConsoleBridge(): null {
  useEffect(() => {
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    (["log", "info", "warn", "error"] as const).forEach((level) => {
      console[level] = (...args: unknown[]) => {
        post(level, args);
        original[level](...args);
      };
    });

    const onError = (event: ErrorEvent) => {
      post("error", [event.message, event.filename, event.lineno, event.colno]);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      post("error", ["Unhandled promise rejection", event.reason]);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    post("info", ["Preview console bridge connected"]);

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
`;
}

export function staleNextDevtoolsCleanupPaths(paths: readonly string[]): string[] {
  if (paths.includes(SRC_APP_LAYOUT_PATH) && paths.includes(APP_DEVTOOLS_CSS_PATH)) {
    return [APP_DEVTOOLS_CSS_PATH];
  }
  if (paths.includes(APP_LAYOUT_PATH) && paths.includes(SRC_APP_DEVTOOLS_CSS_PATH)) {
    return [SRC_APP_DEVTOOLS_CSS_PATH];
  }
  return [];
}
