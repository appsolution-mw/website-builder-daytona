import { Bot, Loader2, Plus, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EnablementState, FileAgentConfigDto } from "./types";

interface FileAgentsTableProps {
  agents: FileAgentConfigDto[];
  onChange: (agents: FileAgentConfigDto[]) => void;
  onSave: (agent: FileAgentConfigDto) => void;
  savingId?: string | null;
  disabled?: boolean;
  stateScope?: "workspace" | "project";
}

const EMPTY_AGENT: FileAgentConfigDto = {
  id: "new-agent",
  name: "",
  description: "",
  body: "",
  tools: [],
  model: "inherit",
  skillNames: [],
  permissionMode: null,
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

export function FileAgentsTable({
  agents,
  onChange,
  onSave,
  savingId = null,
  disabled = false,
  stateScope = "workspace",
}: FileAgentsTableProps) {
  function updateAgent(id: string, patch: Partial<FileAgentConfigDto>): void {
    onChange(agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  }

  function addAgent(): void {
    const suffix = agents.filter((agent) => agent.id.startsWith("new-agent")).length + 1;
    onChange([...agents, { ...EMPTY_AGENT, id: `new-agent-${suffix}` }]);
  }

  return (
    <section className="grid min-h-0 gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">File agents</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Managed `.agents/agents/&lt;name&gt;.md` sub-agent definitions.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addAgent} disabled={disabled}>
          <Plus />
          Agent
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[8rem_1fr_7rem] gap-2 border-b border-border bg-background/55 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[9rem_1fr_8rem_7rem]">
          <span>Name</span>
          <span>Description</span>
          <span className="hidden md:block">Model</span>
          <span>State</span>
        </div>
        <div className="max-h-[34rem] overflow-auto">
          {agents.map((agent) => {
            const state = stateScope === "project"
              ? agent.projectState ?? "INHERITED"
              : agent.workspaceState;
            const saving = savingId === agent.id;
            return (
              <div key={agent.id} className="grid gap-2 border-b border-border p-3 last:border-b-0">
                <div className="grid grid-cols-[8rem_1fr_7rem] gap-2 md:grid-cols-[9rem_1fr_8rem_7rem]">
                  <Input
                    value={agent.name}
                    onChange={(event) => updateAgent(agent.id, { name: event.target.value })}
                    placeholder="reviewer"
                    disabled={disabled || saving}
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    value={agent.description}
                    onChange={(event) => updateAgent(agent.id, { description: event.target.value })}
                    placeholder="What this agent handles"
                    disabled={disabled || saving}
                    className="h-9 text-xs"
                  />
                  <Input
                    value={agent.model}
                    onChange={(event) => updateAgent(agent.id, { model: event.target.value })}
                    placeholder="inherit"
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
                        updateAgent(agent.id, { projectState: nextState(state) });
                      } else {
                        updateAgent(agent.id, { workspaceState: state === "ENABLED" ? "DISABLED" : "ENABLED" });
                      }
                    }}
                  >
                    {state.toLowerCase()}
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    value={listToCsv(agent.tools)}
                    onChange={(event) => updateAgent(agent.id, { tools: csvToList(event.target.value) })}
                    placeholder="read, edit, bash"
                    disabled={disabled || saving}
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    value={listToCsv(agent.skillNames)}
                    onChange={(event) => updateAgent(agent.id, { skillNames: csvToList(event.target.value) })}
                    placeholder="seo, review"
                    disabled={disabled || saving}
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    value={agent.permissionMode ?? ""}
                    onChange={(event) => updateAgent(agent.id, { permissionMode: event.target.value || null })}
                    placeholder="permission mode"
                    disabled={disabled || saving}
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <Textarea
                  value={agent.body}
                  onChange={(event) => updateAgent(agent.id, { body: event.target.value })}
                  placeholder="Agent instructions..."
                  disabled={disabled || saving}
                  spellCheck={false}
                  className="min-h-28 resize-y font-mono text-xs leading-5"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <Bot className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {agent.tools.length > 0 ? agent.tools.join(", ") : "No tools listed"}
                    </span>
                    {stateScope === "project" && <Badge variant="outline">{agent.workspaceState.toLowerCase()} globally</Badge>}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || saving || !agent.name.trim()}
                    onClick={() => onSave(agent)}
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
              </div>
            );
          })}
          {agents.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No managed file agents yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
