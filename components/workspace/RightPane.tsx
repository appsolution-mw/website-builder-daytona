"use client";

import { type ReactNode } from "react";
import { Code2, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";

export type RightPaneTab = "code" | "preview";

export interface RightPaneProps {
  tab: RightPaneTab;
  onTabChange: (tab: RightPaneTab) => void;
  code: ReactNode;
  preview: ReactNode;
}

export function RightPane(props: RightPaneProps) {
  const icons = {
    code: Code2,
    preview: Eye,
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex min-h-12 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
        {(["code", "preview"] as const).map((t) => (
          <Button
            key={t}
            type="button"
            onClick={() => props.onTabChange(t)}
            variant={props.tab === t ? "secondary" : "ghost"}
            size="sm"
            className="h-8 capitalize"
          >
            {(() => {
              const Icon = icons[t];
              return <Icon />;
            })()}
            {t}
          </Button>
        ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 ${props.tab === "code" ? "flex" : "hidden"}`}>
          {props.code}
        </div>
        <div className={`min-w-0 flex-1 ${props.tab === "preview" ? "flex" : "hidden"}`}>
          {props.preview}
        </div>
      </div>
    </section>
  );
}
