"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReasoningEffort = "low" | "medium" | "high";

const REASONING_OPTIONS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Faster, cheaper" },
  { value: "medium", label: "Medium", hint: "Balanced" },
  { value: "high", label: "High", hint: "More thorough" },
];

type ReasoningEffortPickerProps = {
  value: ReasoningEffort;
  disabled?: boolean;
  onSelect: (value: ReasoningEffort) => void;
};

export function ReasoningEffortPicker({ value, disabled, onSelect }: ReasoningEffortPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const current = REASONING_OPTIONS.find((option) => option.value === value) ?? REASONING_OPTIONS[1];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

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
        title={`Reasoning effort: ${current.label}`}
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
          className="absolute bottom-full right-0 z-50 mb-1 min-w-[10rem] rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {REASONING_OPTIONS.map((option) => {
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
                  <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
