"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";

import type { AgentRuntime } from "@wbd/protocol";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReasoningEffort = string;

type ReasoningOption = {
  value: ReasoningEffort;
  label: string;
  hint?: string;
};

// Runtime-specific reasoning options. The lists are hardcoded because
// neither the Anthropic API nor the OpenAI Codex SDK exposes a
// catalog endpoint for valid reasoning levels (verified against the
// official docs as of 2026-05).
//
//   Claude (Anthropic SDK): the `effort` parameter accepts
//     low | medium | high | xhigh | max. The SDK maps this onto the
//     underlying `thinking` config (adaptive vs. enabled+budget) so the
//     same value works across Sonnet 4.x, Opus 4.x, and Haiku.
//     Source: code.claude.com/docs/en/agent-sdk/typescript
//
//   Codex (OpenAI SDK): the `reasoningEffort` field accepts
//     minimal | low | medium | high | xhigh. Same values across CLI
//     (model_reasoning_effort in config.toml) and SDK.
//     Source: developers.openai.com/codex/config-reference
const REASONING_OPTIONS_BY_RUNTIME: Partial<Record<AgentRuntime, ReasoningOption[]>> = {
  "claude-code": [
    { value: "low", label: "Low", hint: "Minimal thinking" },
    { value: "medium", label: "Medium", hint: "Balanced" },
    { value: "high", label: "High", hint: "SDK default" },
    { value: "xhigh", label: "Extra High", hint: "Deeper reasoning" },
    { value: "max", label: "Max", hint: "Largest thinking budget" },
  ],
  "openai-codex": [
    { value: "minimal", label: "Minimal", hint: "Fastest, cheapest" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium", hint: "Recommended default" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High", hint: "Slowest, best quality" },
  ],
};

const DEFAULT_BY_RUNTIME: Partial<Record<AgentRuntime, ReasoningEffort>> = {
  "claude-code": "high",
  "openai-codex": "medium",
};

export function reasoningOptionsForRuntime(runtime: AgentRuntime): ReasoningOption[] {
  return REASONING_OPTIONS_BY_RUNTIME[runtime] ?? [];
}

export function defaultReasoningForRuntime(runtime: AgentRuntime): ReasoningEffort | null {
  return DEFAULT_BY_RUNTIME[runtime] ?? null;
}

type ReasoningEffortPickerProps = {
  runtime: AgentRuntime;
  value: ReasoningEffort;
  disabled?: boolean;
  onSelect: (value: ReasoningEffort) => void;
};

export function ReasoningEffortPicker({ runtime, value, disabled, onSelect }: ReasoningEffortPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const options = reasoningOptionsForRuntime(runtime);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (options.length === 0 || !current) return null;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
        className="h-7 gap-1.5 px-1.5 text-muted-foreground hover:text-foreground"
        title={`Reasoning: ${current.label}`}
      >
        <Sparkles className="opacity-70" aria-hidden="true" />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="shrink-0 opacity-70" aria-hidden="true" />
      </Button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Reasoning effort"
          className="absolute bottom-full right-0 z-50 mb-1 min-w-[12rem] rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                  selected && "bg-accent text-accent-foreground",
                )}
              >
                <Check
                  className={cn("size-4 shrink-0 opacity-0", selected && "opacity-100")}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{option.label}</span>
                  {option.hint && (
                    <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
