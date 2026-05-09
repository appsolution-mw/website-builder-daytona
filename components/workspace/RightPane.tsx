"use client";

import { type ReactNode } from "react";
import { Code2, Eye, GitCommit, ScrollText, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

export type RightPaneTab = "code" | "preview" | "terminal" | "console" | "history";

export interface RightPaneProps {
  tab: RightPaneTab;
  onTabChange: (tab: RightPaneTab) => void;
  code: ReactNode;
  preview: ReactNode;
  terminal: ReactNode;
  console: ReactNode;
  history: ReactNode;
  previewActions?: ReactNode;
  codeActions?: ReactNode;
  terminalActions?: ReactNode;
  consoleActions?: ReactNode;
  historyActions?: ReactNode;
}

const TABS: { id: RightPaneTab; label: string; Icon: typeof Code2 }[] = [
  { id: "code", label: "Code", Icon: Code2 },
  { id: "preview", label: "Preview", Icon: Eye },
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "console", label: "Console", Icon: ScrollText },
  { id: "history", label: "History", Icon: GitCommit },
];

export function RightPane(props: RightPaneProps) {
  const activeActions = props.tab === "preview"
    ? props.previewActions
    : props.tab === "terminal"
      ? props.terminalActions
      : props.tab === "console"
        ? props.consoleActions
        : props.tab === "history"
          ? props.historyActions
          : props.codeActions;

  return (
    <section className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border bg-card px-3">
        <div
          role="tablist"
          aria-label="Workspace view"
          className="flex items-center gap-1 rounded-md border border-border bg-background p-1"
        >
          {TABS.map(({ id, label, Icon }) => {
            const active = props.tab === id;
            return (
              <Button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onTabChange(id)}
                variant={active ? "secondary" : "ghost"}
                size="xs"
              >
                <Icon />
                {label}
              </Button>
            );
          })}
        </div>
        {activeActions ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {activeActions}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 ${props.tab === "code" ? "flex" : "hidden"}`}>
          {props.code}
        </div>
        <div className={`min-w-0 flex-1 ${props.tab === "preview" ? "flex" : "hidden"}`}>
          {props.preview}
        </div>
        <div className={`min-w-0 flex-1 ${props.tab === "terminal" ? "flex" : "hidden"}`}>
          {props.terminal}
        </div>
        <div className={`min-w-0 flex-1 ${props.tab === "console" ? "flex" : "hidden"}`}>
          {props.console}
        </div>
        <div className={`min-w-0 flex-1 ${props.tab === "history" ? "flex" : "hidden"}`}>
          {props.history}
        </div>
      </div>
    </section>
  );
}
