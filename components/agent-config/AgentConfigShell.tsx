import type { ReactNode } from "react";
import { Bot, FileText, Layers3, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AgentConfigTab = "agents-md" | "skills" | "agents";

interface AgentConfigShellProps {
  title: string;
  description: string;
  activeTab: AgentConfigTab;
  onTabChange: (tab: AgentConfigTab) => void;
  stack: ReactNode;
  main: ReactNode;
  preview: ReactNode;
  status?: ReactNode;
  className?: string;
}

const TABS: Array<{ value: AgentConfigTab; label: string; Icon: typeof FileText }> = [
  { value: "agents-md", label: "AGENTS.md", Icon: FileText },
  { value: "skills", label: "Skills", Icon: WandSparkles },
  { value: "agents", label: "Agents", Icon: Bot },
];

export function AgentConfigShell({
  title,
  description,
  activeTab,
  onTabChange,
  stack,
  main,
  preview,
  status,
  className,
}: AgentConfigShellProps) {
  return (
    <main className={cn("min-h-dvh bg-background", className)}>
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <header className="grid gap-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <Layers3 className="size-3.5 text-primary" aria-hidden="true" />
                OpenHands configuration
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            {status}
          </div>
          {stack}
        </header>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ value, label, Icon }) => (
            <Button
              key={value}
              type="button"
              variant={activeTab === value ? "secondary" : "outline"}
              size="sm"
              aria-pressed={activeTab === value}
              onClick={() => onTabChange(value)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>

        <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
          <section className="min-h-0 rounded-lg border border-border bg-card p-4">{main}</section>
          {preview}
        </div>
      </div>
    </main>
  );
}
