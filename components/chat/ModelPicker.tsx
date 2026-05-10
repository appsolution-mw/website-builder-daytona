"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

import type { AgentRuntime } from "@wbd/protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ModelOption = {
  id: string;
  label: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
  inputModalities: string[];
};

export type ModelPickerRuntime = {
  runtime: AgentRuntime;
  label: string;
  models: ModelOption[];
  loading: boolean;
};

type ModelPickerProps = {
  runtimes: ModelPickerRuntime[];
  activeRuntime: AgentRuntime;
  selectedModelId: string | null;
  disabled: boolean;
  onSelect: (modelId: string) => void;
  onRuntimeChange: (runtime: AgentRuntime) => void;
  /**
   * Borderless trigger that fits inside an enclosing input container
   * (claude.ai / chatgpt-style). Defaults to false.
   */
  compact?: boolean;
};

const MAX_VISIBLE_MODELS = 40;

function formatContextLength(contextLength: number): string {
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k ctx`;
  if (contextLength > 0) return `${contextLength} ctx`;
  return "ctx n/a";
}

export function ModelPicker({
  runtimes,
  activeRuntime,
  selectedModelId,
  disabled,
  onSelect,
  onRuntimeChange,
  compact = false,
}: ModelPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Trigger rect drives a fixed-position portal in compact mode so the
  // dropdown is never clipped by ancestor overflow:hidden (chat section,
  // sidebar etc.). Recomputed on open + viewport changes.
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  // Reset the search query during render when the active runtime changes —
  // canonical "deriving state from props" pattern, avoids the
  // setState-in-effect lint and the extra render pass.
  const [trackedRuntime, setTrackedRuntime] = useState(activeRuntime);
  if (trackedRuntime !== activeRuntime) {
    setTrackedRuntime(activeRuntime);
    setQuery("");
  }

  const activeRuntimeData = useMemo(
    () => runtimes.find((r) => r.runtime === activeRuntime),
    [runtimes, activeRuntime],
  );
  const models = useMemo(() => activeRuntimeData?.models ?? [], [activeRuntimeData]);
  const loading = activeRuntimeData?.loading ?? false;

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const triggerLabel = loading
    ? "Loading models..."
    : selectedModel?.label ?? selectedModelId ?? "Select model";

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? models.filter((model) => {
          const label = model.label.toLowerCase();
          const id = model.id.toLowerCase();
          return label.includes(normalizedQuery) || id.includes(normalizedQuery);
        })
      : models;

    return filtered.slice(0, MAX_VISIBLE_MODELS);
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !compact) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setTriggerRect(rect);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, compact]);

  function renderPanelContent() {
    return (
      <>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            aria-label="Search models"
            placeholder="Search models"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${activeRuntimeData?.label ?? "Models"} models`}
          className="mt-2 max-h-72 overflow-y-auto [scrollbar-gutter:stable]"
        >
          {loading ? (
            <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </li>
          ) : visibleModels.length > 0 ? (
            visibleModels.map((model) => {
              const selected = model.id === selectedModelId;
              return (
                <li key={model.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(model.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                      selected && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Check
                      className={cn("size-4 shrink-0 opacity-0", selected && "opacity-100")}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{model.label}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {model.id}
                      </span>
                    </span>
                    {model.contextLength > 0 && (
                      <Badge variant="outline" className="shrink-0">
                        {formatContextLength(model.contextLength)}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-2 py-3 text-sm text-muted-foreground">No models found</li>
          )}
        </ul>
        {runtimes.length > 1 && (
          <div
            role="tablist"
            aria-label="Switch runtime"
            className="mt-2 flex shrink-0 gap-1 border-t border-border pt-2"
          >
            {runtimes.map((rt) => {
              const active = rt.runtime === activeRuntime;
              return (
                <button
                  key={rt.runtime}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onRuntimeChange(rt.runtime)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {rt.label}
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  function renderPanel() {
    if (!compact) {
      return (
        <div
          ref={panelRef}
          className="absolute bottom-full left-0 right-0 z-50 mb-1 min-w-0 w-full max-w-full rounded-md border border-border bg-popover p-2 shadow-lg"
        >
          {renderPanelContent()}
        </div>
      );
    }
    if (typeof document === "undefined" || !triggerRect) return null;
    // Right-anchor the panel under the trigger but clamp to the viewport so a
    // wide model list / a trigger close to the left edge doesn't push the
    // dropdown off-screen. Falls back to a left-aligned panel that fills the
    // viewport on small screens.
    const SIDE_MARGIN = 8;
    const PREFERRED_WIDTH = 22 * 16;
    const width = Math.min(PREFERRED_WIDTH, window.innerWidth - SIDE_MARGIN * 2);
    const idealLeft = triggerRect.right - width;
    const left = Math.max(SIDE_MARGIN, idealLeft);
    return createPortal(
      <div
        ref={panelRef}
        className="fixed z-[100] min-w-0 rounded-md border border-border bg-popover p-2 shadow-lg"
        style={{
          bottom: window.innerHeight - triggerRect.top + 4,
          left,
          width,
        }}
      >
        {renderPanelContent()}
      </div>,
      document.body,
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative min-w-0",
        compact ? "max-w-[14rem]" : "flex-1 sm:max-w-sm",
      )}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "xs" : "sm"}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "min-w-0 justify-between gap-1.5 text-muted-foreground hover:text-foreground",
          compact ? "h-7 px-1.5" : "h-9 w-full px-2.5",
        )}
        title={triggerLabel}
      >
        <span className="min-w-0 truncate text-left">{triggerLabel}</span>
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ChevronDown className="shrink-0 opacity-70" aria-hidden="true" />
        )}
      </Button>
      {open && renderPanel()}
    </div>
  );
}
