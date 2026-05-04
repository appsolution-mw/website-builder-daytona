import { AlertTriangle, Loader2, Save, X } from "lucide-react";

import { AgentsMdEditor } from "@/components/agent-config/AgentsMdEditor";
import { EffectiveConfigPreview } from "@/components/agent-config/EffectiveConfigPreview";
import { FileAgentsTable } from "@/components/agent-config/FileAgentsTable";
import { InheritanceStack } from "@/components/agent-config/InheritanceStack";
import { SkillsTable } from "@/components/agent-config/SkillsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AgentConfigMode,
  EnablementState,
  FileAgentConfigDto,
  ProjectAgentConfigInput,
  ProjectAgentConfigResponse,
  SkillConfigDto,
} from "./types";

interface ProjectAgentConfigPanelProps {
  config: ProjectAgentConfigResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  syncWarning: string | null;
  disabled: boolean;
  onClose: () => void;
  onReload: () => void;
  onSave: (input: ProjectAgentConfigInput) => void;
  onLocalChange: (config: ProjectAgentConfigResponse) => void;
}

const MODES: Array<{ value: AgentConfigMode; label: string }> = [
  { value: "INHERIT", label: "Inherit" },
  { value: "EXTEND", label: "Extend" },
  { value: "REPLACE", label: "Replace" },
];

function skillStates(skills: SkillConfigDto[]): Record<string, EnablementState> {
  const entries: Array<[string, EnablementState]> = skills.map((skill) => [
    skill.id,
    skill.projectState ?? "INHERITED",
  ]);
  return Object.fromEntries(entries);
}

function agentStates(agents: FileAgentConfigDto[]): Record<string, EnablementState> {
  const entries: Array<[string, EnablementState]> = agents.map((agent) => [
    agent.id,
    agent.projectState ?? "INHERITED",
  ]);
  return Object.fromEntries(entries);
}

export function ProjectAgentConfigPanel({
  config,
  loading,
  saving,
  error,
  syncWarning,
  disabled,
  onClose,
  onReload,
  onSave,
  onLocalChange,
}: ProjectAgentConfigPanelProps) {
  const enabledSkills = config?.effective.skills.filter((skill) => skill.enabled).length ?? 0;
  const enabledAgents = config?.effective.agents.filter((agent) => agent.enabled).length ?? 0;

  function patchConfig(patch: Partial<ProjectAgentConfigResponse>): void {
    if (!config) return;
    onLocalChange({ ...config, ...patch });
  }

  function patchProjectConfig(projectConfig: ProjectAgentConfigResponse["projectConfig"]): void {
    patchConfig({ projectConfig });
  }

  function saveCurrent(): void {
    if (!config) return;
    onSave({
      agentsMode: config.projectConfig.agentsMode,
      agentsMd: config.projectConfig.agentsMd,
      skillStates: skillStates(config.skills),
      agentStates: agentStates(config.agents),
    });
  }

  return (
    <aside className="flex w-[min(38rem,52vw)] min-w-[30rem] shrink-0 flex-col border-l border-border bg-card max-xl:absolute max-xl:inset-0 max-xl:z-20 max-xl:w-full max-xl:min-w-0 max-xl:shadow-lg">
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">Agent config</span>
          {disabled && <Badge variant="warning">agent busy</Badge>}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close agent config" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading agent configuration...
          </div>
        )}
        {error && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{error}</span>
            <Button type="button" variant="ghost" size="xs" onClick={onReload}>Retry</Button>
          </div>
        )}
        {syncWarning && (
          <div role="status" className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            {syncWarning}
          </div>
        )}
        {config && (
          <div className="grid gap-4">
            <InheritanceStack
              compact
              mode={config.projectConfig.agentsMode}
              projectName={config.project.name}
              skillsEnabled={enabledSkills}
              agentsEnabled={enabledAgents}
              filesCount={config.materializedFiles.length}
            />

            <section className="grid gap-2 rounded-lg border border-border bg-background/55 p-3">
              <label htmlFor="project-agent-mode" className="text-xs font-medium text-muted-foreground">
                Project mode
              </label>
              <select
                id="project-agent-mode"
                value={config.projectConfig.agentsMode}
                disabled={disabled || saving}
                onChange={(event) => {
                  patchProjectConfig({
                    ...config.projectConfig,
                    agentsMode: event.target.value as AgentConfigMode,
                  });
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </section>

            <AgentsMdEditor
              id="project-agents-md"
              label="Project AGENTS.md"
              value={config.projectConfig.agentsMd}
              disabled={disabled || saving}
              saving={saving}
              onChange={(agentsMd) => {
                patchProjectConfig({ ...config.projectConfig, agentsMd });
              }}
              onSave={saveCurrent}
              description="Project-specific context applied according to the selected mode."
            />

            <SkillsTable
              skills={config.skills}
              stateScope="project"
              disabled={disabled || saving}
              onChange={(skills) => patchConfig({ skills })}
              onSave={saveCurrent}
            />

            <FileAgentsTable
              agents={config.agents}
              stateScope="project"
              disabled={disabled || saving}
              onChange={(agents) => patchConfig({ agents })}
              onSave={saveCurrent}
            />

            <EffectiveConfigPreview
              effective={config.effective}
              files={config.materializedFiles}
              className="min-h-[28rem]"
            />
          </div>
        )}
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border px-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {disabled ? "Wait for the current agent turn before saving." : "Saves update project settings and live sandbox files."}
        </span>
        <Button type="button" size="sm" disabled={!config || disabled || saving} onClick={saveCurrent}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </aside>
  );
}
