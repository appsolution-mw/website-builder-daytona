"use client";

import { AlertTriangle, Bot, ImageIcon, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { summariseAgentLabel } from "@/lib/agents/labels";
import { runtimeLabel } from "@/lib/agents/runtime";
import type { CommitView } from "@/lib/workspace/commit-types";
import { AgentTurnCommitChip } from "./AgentTurnCommitChip";

export type ChatImageAttachmentView = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
};

export type ChatMessageView =
  | { kind: "user"; turnId: string; text: string; attachments?: ChatImageAttachmentView[] }
  | {
      kind: "agent";
      turnId: string;
      agentId?: string;
      runtime?: string;
      modelId?: string | null;
      text: string;
      streaming: boolean;
      tools: string[];
      footer: string | null;
    }
  | {
      kind: "error";
      turnId: string | null;
      agentId?: string;
      runtime?: string;
      modelId?: string | null;
      text: string;
    };

function ActivityDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      <span className="size-1 rounded-full bg-current animate-pulse" />
      <span className="size-1 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
      <span className="size-1 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
    </span>
  );
}

function ActivityStatus({ tools }: { tools: string[] }) {
  const label = tools.at(-1) ?? "Working on it";
  const count = tools.length;

  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-xs text-muted-foreground">
      <span className="truncate">
        {label}
        {count > 1 ? ` (${count} steps)` : ""}
      </span>
      <ActivityDots />
    </div>
  );
}

export function Message({
  m,
  commit,
  isHeadCommit,
  isProjectIdle,
  onRevertCommit,
}: {
  m: ChatMessageView;
  commit?: CommitView;
  isHeadCommit?: boolean;
  isProjectIdle?: boolean;
  onRevertCommit?: (commit: CommitView) => void;
}) {
  if (m.kind === "user") {
    return (
      <li className="self-end max-w-[88%] rounded-lg bg-primary px-3 py-2 text-primary-foreground shadow-sm">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
          <User className="size-3.5" />
          You
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6">{m.text}</div>
        {m.attachments && m.attachments.length > 0 && (
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {m.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="overflow-hidden rounded-md border border-primary-foreground/20 bg-black/15"
                title={attachment.name}
              >
                {attachment.dataUrl ? (
                  <div
                    role="img"
                    aria-label={attachment.name}
                    className="h-24 w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${attachment.dataUrl})` }}
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center">
                    <ImageIcon className="size-5 opacity-75" aria-hidden="true" />
                  </div>
                )}
                <div className="truncate px-2 py-1 text-xs opacity-85">{attachment.name}</div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }
  if (m.kind === "error") {
    return (
      <li className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-100">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="font-mono text-xs">
            {m.agentId ? `${summariseAgentLabel(m.agentId)} error: ` : "error: "}
            {m.text}
          </span>
        </div>
      </li>
    );
  }
  const label = summariseAgentLabel(m.agentId);
  const isReviewer = m.agentId === "reviewer";
  const bubbleClass = isReviewer
    ? "max-w-[92%] rounded-lg border border-amber-400/30 bg-amber-50/5 px-3 py-2 shadow-sm"
    : "max-w-[92%] rounded-lg border border-border bg-card px-3 py-2 shadow-sm";
  return (
    <li className={bubbleClass}>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bot className="size-3.5" />
        {label}
        {m.runtime && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">
            {runtimeLabel(m.runtime)}
            {m.modelId ? ` · ${m.modelId}` : ""}
          </span>
        )}
      </div>
      <div className="text-sm leading-6 text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-background [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-blue-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
        {m.text.trim().length > 0 && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
        )}
        {m.streaming && <ActivityStatus tools={m.tools} />}
      </div>
      {m.footer && <div className="mt-2 text-xs text-muted-foreground">{m.footer}</div>}
      {commit && onRevertCommit && (
        <AgentTurnCommitChip
          commit={commit}
          isHead={Boolean(isHeadCommit)}
          isProjectIdle={Boolean(isProjectIdle)}
          onRevertClick={onRevertCommit}
        />
      )}
    </li>
  );
}
