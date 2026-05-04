import { Bot, FileText, ScrollText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EffectiveAgentConfig, MaterializedAgentFile } from "./types";

interface EffectiveConfigPreviewProps {
  effective: EffectiveAgentConfig;
  files?: MaterializedAgentFile[];
  className?: string;
}

function fileRows(effective: EffectiveAgentConfig, files?: MaterializedAgentFile[]): MaterializedAgentFile[] {
  if (files && files.length > 0) return files;
  return [
    { path: "AGENTS.md", content: effective.agentsMd },
    ...effective.skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        path: `.agents/skills/${skill.name}/SKILL.md`,
        content: skill.body,
      })),
    ...effective.agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        path: `.agents/agents/${agent.name}.md`,
        content: agent.body,
      })),
  ];
}

export function EffectiveConfigPreview({
  effective,
  files,
  className,
}: EffectiveConfigPreviewProps) {
  const enabledSkills = effective.skills.filter((skill) => skill.enabled);
  const enabledAgents = effective.agents.filter((agent) => agent.enabled);
  const rows = fileRows(effective, files);

  return (
    <aside className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-card", className)}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ScrollText className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">Effective preview</span>
        </div>
        <Badge variant="outline">{rows.length} files</Badge>
      </div>
      <div className="grid gap-3 border-b border-border p-3 text-xs sm:grid-cols-3">
        <div>
          <div className="text-muted-foreground">AGENTS.md</div>
          <div className="mt-1 font-semibold tabular-nums">{effective.agentsMd.length} chars</div>
        </div>
        <div>
          <div className="text-muted-foreground">Skills</div>
          <div className="mt-1 font-semibold tabular-nums">{enabledSkills.length}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Agents</div>
          <div className="mt-1 font-semibold tabular-nums">{enabledAgents.length}</div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="grid gap-2 border-b border-border p-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Enabled entries
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...enabledSkills.map((skill) => `skill:${skill.name}`), ...enabledAgents.map((agent) => `agent:${agent.name}`)]
              .slice(0, 12)
              .map((label) => (
                <Badge key={label} variant="secondary">{label}</Badge>
              ))}
            {enabledSkills.length + enabledAgents.length === 0 && (
              <span className="text-muted-foreground">No enabled skills or file agents.</span>
            )}
          </div>
        </div>
        <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(11rem,0.75fr)_minmax(0,1.25fr)]">
          <ul className="min-h-0 overflow-auto border-b border-border p-2 text-xs lg:border-b-0 lg:border-r">
            {rows.map((file) => (
              <li key={file.path} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate font-mono" title={file.path}>{file.path}</span>
              </li>
            ))}
          </ul>
          <pre className="min-h-56 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-5 text-muted-foreground">
            {effective.agentsMd || "No AGENTS.md content yet."}
          </pre>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Bot className="size-3.5" aria-hidden="true" />
        Preview reflects the next managed OpenHands files.
      </div>
    </aside>
  );
}
