import { ArrowDown, CheckCircle2, CircleDashed, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentConfigMode } from "./types";

interface InheritanceStackProps {
  mode?: AgentConfigMode;
  projectName?: string;
  skillsEnabled: number;
  agentsEnabled: number;
  filesCount?: number;
  compact?: boolean;
}

function modeLabel(mode?: AgentConfigMode): string {
  if (mode === "REPLACE") return "replace workspace";
  if (mode === "INHERIT") return "inherit only";
  return "extend workspace";
}

export function InheritanceStack({
  mode,
  projectName,
  skillsEnabled,
  agentsEnabled,
  filesCount,
  compact = false,
}: InheritanceStackProps) {
  const items = [
    { label: "Workspace", detail: "Global AGENTS.md, skills, and file agents" },
    {
      label: projectName ?? "Effective config",
      detail: projectName ? modeLabel(mode) : "Preview of enabled workspace entries",
    },
    {
      label: "Sandbox files",
      detail: `${skillsEnabled} skills, ${agentsEnabled} agents${filesCount === undefined ? "" : `, ${filesCount} files`}`,
    },
  ];

  return (
    <div className={cn("grid gap-2", compact ? "text-xs" : "sm:grid-cols-[1fr_auto_1fr_auto_1fr]")}>
      {items.map((item, index) => (
        <div key={item.label} className="contents">
          <div className="rounded-lg border border-border bg-background/55 p-3">
            <div className="flex items-center gap-2 font-medium text-foreground">
              {index === 2 ? (
                <CheckCircle2 className="size-4 text-emerald-300" aria-hidden="true" />
              ) : index === 1 ? (
                <CircleDashed className="size-4 text-primary" aria-hidden="true" />
              ) : (
                <FileText className="size-4 text-primary" aria-hidden="true" />
              )}
              <span>{item.label}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{item.detail}</p>
          </div>
          {index < items.length - 1 && !compact && (
            <div className="hidden items-center justify-center text-muted-foreground sm:flex">
              <ArrowDown className="size-4 -rotate-90" aria-hidden="true" />
            </div>
          )}
        </div>
      ))}
      {mode && (
        <Badge variant="outline" className="w-fit">
          {modeLabel(mode)}
        </Badge>
      )}
    </div>
  );
}
