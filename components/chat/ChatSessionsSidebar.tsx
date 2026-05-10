"use client";

import { ChevronLeft, MessageSquare, PanelLeftOpen, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatSessionPreview = {
  id: string;
  title: string;
  messageCount: number;
};

type ChatSessionsSidebarProps = {
  sessions: ChatSessionPreview[];
  activeSessionId: string | null;
  collapsed: boolean;
  loading: boolean;
  newDisabled: boolean;
  onToggleCollapse: () => void;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
};

export function ChatSessionsSidebar({
  sessions,
  activeSessionId,
  collapsed,
  loading,
  newDisabled,
  onToggleCollapse,
  onSelect,
  onNew,
}: ChatSessionsSidebarProps) {
  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background/45 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapse}
          aria-label="Expand chat sessions sidebar"
          title="Expand sessions"
        >
          <PanelLeftOpen />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onNew}
          disabled={newDisabled}
          aria-label="New chat"
          title="New chat"
        >
          <Plus />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background/45">
      <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4 text-primary" aria-hidden="true" />
          Chats
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleCollapse}
          aria-label="Collapse chat sessions sidebar"
          title="Collapse sessions"
        >
          <ChevronLeft />
        </Button>
      </div>
      <div className="shrink-0 px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNew}
          disabled={newDisabled}
          className="w-full justify-start gap-2"
        >
          <Plus />
          New chat
        </Button>
      </div>
      <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recent
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1 [scrollbar-gutter:stable]">
        {sessions.length === 0 ? (
          <li className="px-2 py-3 text-xs text-muted-foreground">No chats yet</li>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  disabled={loading}
                  title={session.title}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    active ? "bg-accent text-accent-foreground" : "text-foreground/85",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {session.messageCount > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {session.messageCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
