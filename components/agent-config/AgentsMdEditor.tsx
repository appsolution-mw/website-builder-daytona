import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AgentsMdEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
  disabled?: boolean;
  description?: string;
}

export function AgentsMdEditor({
  id,
  label,
  value,
  onChange,
  onSave,
  saving = false,
  disabled = false,
  description,
}: AgentsMdEditorProps) {
  return (
    <section className="grid min-h-0 gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
          </label>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button type="button" size="sm" onClick={onSave} disabled={disabled || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || saving}
        spellCheck={false}
        className="min-h-[28rem] resize-none font-mono text-xs leading-5"
      />
    </section>
  );
}
