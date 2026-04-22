"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Check, FileCode2, Loader2, Save, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading editor...
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
          <FileCode2 className="size-5" />
        </div>
        <span>Select a file from the tree to view it.</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border bg-card px-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <FileCode2 className="size-4 shrink-0" />
          <span className="truncate font-mono">{path}</span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-400" aria-label="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2">
          {readOnly && (
            <Badge variant="warning">Agent editing</Badge>
          )}
          {saveIndicator === "saved" && (
            <Badge variant="success">
              <Check className="size-3.5" />
              saved
            </Badge>
          )}
          {saveIndicator === "error" && (
            <Badge variant="destructive">
              <TriangleAlert className="size-3.5" />
              error{saveError ? `: ${saveError}` : ""}
            </Badge>
          )}
          <Button
            type="button"
            onClick={onSave}
            disabled={readOnly || !dirty}
            variant="secondary"
            size="sm"
          >
            <Save />
            Save
          </Button>
        </div>
      </div>
      <div className="flex-1">
        {content === null ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading...
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
              fontLigatures: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16, bottom: 16 },
            }}
            theme="vs-dark"
          />
        )}
      </div>
    </div>
  );
}
