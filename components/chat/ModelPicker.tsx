"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

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
};

type ModelPickerProps = {
  models: ModelOption[];
  selectedModelId: string | null;
  loading: boolean;
  disabled: boolean;
  onSelect: (modelId: string) => void;
};

const MAX_VISIBLE_MODELS = 40;

function formatContextLength(contextLength: number): string {
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k ctx`;
  if (contextLength > 0) return `${contextLength} ctx`;
  return "ctx n/a";
}

export function ModelPicker({
  models,
  selectedModelId,
  loading,
  disabled,
  onSelect,
}: ModelPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

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
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:max-w-sm">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((value) => !value)}
        className="h-9 w-full min-w-0 justify-between px-2.5"
        title={triggerLabel}
      >
        <span className="min-w-0 truncate text-left">{triggerLabel}</span>
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ChevronDown className="shrink-0" aria-hidden="true" />
        )}
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 w-full min-w-0 max-w-full rounded-md border border-border bg-popover p-2 shadow-lg">
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
              aria-label="Search OpenRouter models"
              placeholder="Search models"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label="OpenRouter models"
            className="mt-2 max-h-72 overflow-y-auto [scrollbar-gutter:stable]"
          >
            {visibleModels.length > 0 ? (
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
                      <Badge variant="outline" className="shrink-0">
                        {formatContextLength(model.contextLength)}
                      </Badge>
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-2 py-3 text-sm text-muted-foreground">No models found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
