"use client";

import { AlertTriangle, Bot, ChevronRight, Terminal, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { summariseAgentLabel } from "@/lib/agents/labels";

export type ChatMessageView =
  | { kind: "user"; turnId: string; text: string }
  | {
      kind: "agent";
      turnId: string;
      agentId?: string;
      text: string;
      streaming: boolean;
      tools: string[];
      footer: string | null;
    }
  | { kind: "error"; turnId: string | null; agentId?: string; text: string };

export function Message({ m }: { m: ChatMessageView }) {
  if (m.kind === "user") {
    return (
      <li className="self-end max-w-[88%] rounded-lg bg-primary px-3 py-2 text-primary-foreground shadow-sm">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
          <User className="size-3.5" />
          You
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6">{m.text}</div>
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
      </div>
      {m.tools.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {m.tools.map((t, i) => (
            <li key={i}>
              <Badge variant="outline" className="max-w-full">
                <Terminal className="size-3.5" />
                <span className="truncate">{t}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="text-sm leading-6 text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-background [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-blue-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
        {m.streaming && <ChevronRight className="inline size-4 animate-pulse text-primary" />}
      </div>
      {m.footer && <div className="mt-2 text-xs text-muted-foreground">{m.footer}</div>}
    </li>
  );
}
