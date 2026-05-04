import { Loader2, Plus, Save, WandSparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EnablementState, SkillConfigDto } from "./types";

interface SkillsTableProps {
  skills: SkillConfigDto[];
  onChange: (skills: SkillConfigDto[]) => void;
  onSave: (skill: SkillConfigDto) => void;
  savingId?: string | null;
  disabled?: boolean;
  stateScope?: "workspace" | "project";
}

const EMPTY_SKILL: SkillConfigDto = {
  id: "new-skill",
  name: "",
  description: "",
  body: "",
  triggers: [],
  workspaceState: "ENABLED",
  projectState: "INHERITED",
};

function csvToList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function listToCsv(value: string[]): string {
  return value.join(", ");
}

function nextState(current: EnablementState): EnablementState {
  if (current === "ENABLED") return "DISABLED";
  if (current === "DISABLED") return "INHERITED";
  return "ENABLED";
}

export function SkillsTable({
  skills,
  onChange,
  onSave,
  savingId = null,
  disabled = false,
  stateScope = "workspace",
}: SkillsTableProps) {
  function updateSkill(id: string, patch: Partial<SkillConfigDto>): void {
    onChange(skills.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)));
  }

  function addSkill(): void {
    const suffix = skills.filter((skill) => skill.id.startsWith("new-skill")).length + 1;
    onChange([...skills, { ...EMPTY_SKILL, id: `new-skill-${suffix}` }]);
  }

  return (
    <section className="grid min-h-0 gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Skills</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Managed `.agents/skills/&lt;name&gt;/SKILL.md` entries.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addSkill} disabled={disabled}>
          <Plus />
          Skill
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[8rem_1fr_7rem] gap-2 border-b border-border bg-background/55 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[9rem_1fr_13rem_7rem]">
          <span>Name</span>
          <span>Description</span>
          <span className="hidden md:block">Triggers</span>
          <span>State</span>
        </div>
        <div className="max-h-[34rem] overflow-auto">
          {skills.map((skill) => {
            const state = stateScope === "project"
              ? skill.projectState ?? "INHERITED"
              : skill.workspaceState;
            const saving = savingId === skill.id;
            return (
              <div key={skill.id} className="grid gap-2 border-b border-border p-3 last:border-b-0">
                <div className="grid grid-cols-[8rem_1fr_7rem] gap-2 md:grid-cols-[9rem_1fr_13rem_7rem]">
                  <Input
                    value={skill.name}
                    onChange={(event) => updateSkill(skill.id, { name: event.target.value })}
                    placeholder="seo"
                    disabled={disabled || saving}
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    value={skill.description}
                    onChange={(event) => updateSkill(skill.id, { description: event.target.value })}
                    placeholder="When to use this skill"
                    disabled={disabled || saving}
                    className="h-9 text-xs"
                  />
                  <Input
                    value={listToCsv(skill.triggers)}
                    onChange={(event) => updateSkill(skill.id, { triggers: csvToList(event.target.value) })}
                    placeholder="seo, metadata"
                    disabled={disabled || saving}
                    className="hidden h-9 font-mono text-xs md:block"
                  />
                  <Button
                    type="button"
                    variant={state === "ENABLED" ? "secondary" : "outline"}
                    size="sm"
                    disabled={disabled || saving}
                    onClick={() => {
                      if (stateScope === "project") {
                        updateSkill(skill.id, { projectState: nextState(state) });
                      } else {
                        updateSkill(skill.id, { workspaceState: state === "ENABLED" ? "DISABLED" : "ENABLED" });
                      }
                    }}
                  >
                    {state.toLowerCase()}
                  </Button>
                </div>
                <Textarea
                  value={skill.body}
                  onChange={(event) => updateSkill(skill.id, { body: event.target.value })}
                  placeholder="Skill instructions..."
                  disabled={disabled || saving}
                  spellCheck={false}
                  className="min-h-28 resize-y font-mono text-xs leading-5"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <WandSparkles className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {skill.triggers.length > 0 ? skill.triggers.join(", ") : "No triggers"}
                    </span>
                    {stateScope === "project" && <Badge variant="outline">{skill.workspaceState.toLowerCase()} globally</Badge>}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || saving || !skill.name.trim()}
                    onClick={() => onSave(skill)}
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
              </div>
            );
          })}
          {skills.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No managed skills yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
