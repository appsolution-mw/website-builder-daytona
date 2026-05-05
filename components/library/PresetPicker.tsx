"use client";

import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

export type PresetOption = {
  id: string;
  name: string;
  description: string;
};

type PresetPickerProps = {
  presets: PresetOption[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
};

export function PresetPicker(props: PresetPickerProps): ReactElement {
  if (props.presets.length === 0) {
    return <p className="text-sm text-muted-foreground">No workflow presets available.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {props.presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant={props.selectedId === preset.id ? "default" : "outline"}
          disabled={props.disabled}
          onClick={() => props.onSelect(preset.id)}
          title={preset.description || preset.name}
          aria-pressed={props.selectedId === preset.id}
        >
          {preset.name}
        </Button>
      ))}
    </div>
  );
}
