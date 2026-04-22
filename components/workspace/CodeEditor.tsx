"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-400">
      Loading editor…
    </div>
  ),
});

export interface CodeEditorProps {
  path: string | null;
  content: string | null;
  readOnly: boolean;
  dirty: boolean;
  saveIndicator: "idle" | "saved" | "error";
  saveError: string | null;
  onContentChange: (content: string) => void;
  onSave: () => void;
}

function guessLanguage(path: string | null): string {
  if (!path) return "plaintext";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}

export function CodeEditor(props: CodeEditorProps) {
  const { path, content, readOnly, dirty, saveIndicator, saveError, onContentChange, onSave } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!readOnly && dirty) onSave();
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [readOnly, dirty, onSave]);

  if (!path) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
        Select a file from the tree to view it.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1 text-xs">
        <div className="flex items-center gap-2 text-gray-600">
          <span className="font-mono">{path}</span>
          {dirty && <span className="text-amber-600">•</span>}
        </div>
        <div className="flex items-center gap-2">
          {readOnly && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">
              Agent editing — save disabled
            </span>
          )}
          {saveIndicator === "saved" && <span className="text-green-700">saved</span>}
          {saveIndicator === "error" && (
            <span className="text-red-700">error{saveError ? `: ${saveError}` : ""}</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={readOnly || !dirty}
            className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
      <div className="flex-1">
        {content === null ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Loading…
          </div>
        ) : (
          <Monaco
            height="100%"
            path={path}
            language={guessLanguage(path)}
            value={content}
            onChange={(v) => onContentChange(v ?? "")}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
