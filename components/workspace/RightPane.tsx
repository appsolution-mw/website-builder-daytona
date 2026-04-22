"use client";

import { type ReactNode } from "react";

export type RightPaneTab = "code" | "preview";

export interface RightPaneProps {
  tab: RightPaneTab;
  onTabChange: (tab: RightPaneTab) => void;
  code: ReactNode;
  preview: ReactNode;
}

export function RightPane(props: RightPaneProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-1 text-xs">
        {(["code", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => props.onTabChange(t)}
            className={`rounded px-3 py-1 capitalize ${
              props.tab === t ? "bg-gray-100 font-semibold" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-1 min-h-0">
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
