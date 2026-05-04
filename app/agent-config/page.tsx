"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

import { AgentConfigShell, type AgentConfigTab } from "@/components/agent-config/AgentConfigShell";
import { AgentsMdEditor } from "@/components/agent-config/AgentsMdEditor";
import { EffectiveConfigPreview } from "@/components/agent-config/EffectiveConfigPreview";
import { FileAgentsTable } from "@/components/agent-config/FileAgentsTable";
import { InheritanceStack } from "@/components/agent-config/InheritanceStack";
import { SkillsTable } from "@/components/agent-config/SkillsTable";
import {
  effectiveFromEditableConfig,
  normalizeGlobalAgentConfigResponse,
} from "@/components/agent-config/normalizers";
import type {
  FileAgentConfigDto,
  GlobalAgentConfigResponse,
  SkillConfigDto,
} from "@/components/agent-config/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function responseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function mergeResponse<T extends object>(base: T, body: unknown): T | (T & Record<string, unknown>) {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? { ...base, ...body }
    : base;
}

function withEffective(config: GlobalAgentConfigResponse): GlobalAgentConfigResponse {
  return {
    ...config,
    effective: effectiveFromEditableConfig({
      agentsMd: config.agentsMd,
      skills: config.skills,
      agents: config.agents,
    }),
  };
}

export default function AgentConfigPage() {
  const [activeTab, setActiveTab] = useState<AgentConfigTab>("agents-md");
  const [config, setConfig] = useState<GlobalAgentConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialConfig(): Promise<void> {
      try {
        const res = await fetch("/api/agent-config", { cache: "no-store" });
        const body = await responseJson(res);
        if (!res.ok) {
          const record = typeof body === "object" && body !== null ? body as { error?: string } : {};
          throw new Error(record.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) setConfig(normalizeGlobalAgentConfigResponse(body));
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, "agent config load failed"));
          setConfig(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInitialConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  async function putConfig(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await responseJson(res);
    if (!res.ok) {
      const record = typeof json === "object" && json !== null ? json as { error?: string; message?: string } : {};
      throw new Error(record.message ?? record.error ?? `HTTP ${res.status}`);
    }
    return json;
  }

  async function saveAgentsMd(): Promise<void> {
    if (!config) return;
    setSavingTarget("agents-md");
    setError(null);
    try {
      const body = await putConfig("/api/agent-config", { agentsMd: config.agentsMd });
      setConfig(normalizeGlobalAgentConfigResponse(mergeResponse(config, body)));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(errorMessage(err, "AGENTS.md save failed"));
    } finally {
      setSavingTarget(null);
    }
  }

  async function saveSkill(skill: SkillConfigDto): Promise<void> {
    if (!config) return;
    setSavingTarget(skill.id);
    setError(null);
    try {
      const body = await putConfig("/api/agent-config/skills", skill);
      const next = normalizeGlobalAgentConfigResponse(mergeResponse(config, body));
      setConfig(next.skills.length > 0 ? next : withEffective(config));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(errorMessage(err, "skill save failed"));
    } finally {
      setSavingTarget(null);
    }
  }

  async function saveAgent(agent: FileAgentConfigDto): Promise<void> {
    if (!config) return;
    setSavingTarget(agent.id);
    setError(null);
    try {
      const body = await putConfig("/api/agent-config/agents", agent);
      const next = normalizeGlobalAgentConfigResponse(mergeResponse(config, body));
      setConfig(next.agents.length > 0 ? next : withEffective(config));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(errorMessage(err, "file agent save failed"));
    } finally {
      setSavingTarget(null);
    }
  }

  const effective = useMemo(() => {
    if (!config) {
      return effectiveFromEditableConfig({ agentsMd: "", skills: [], agents: [] });
    }
    return effectiveFromEditableConfig({
      agentsMd: config.agentsMd,
      skills: config.skills,
      agents: config.agents,
    });
  }, [config]);

  const enabledSkills = effective.skills.filter((skill) => skill.enabled).length;
  const enabledAgents = effective.agents.filter((agent) => agent.enabled).length;

  const main = config ? (
    <>
      {activeTab === "agents-md" && (
        <AgentsMdEditor
          id="workspace-agents-md"
          label="Workspace AGENTS.md"
          value={config.agentsMd}
          saving={savingTarget === "agents-md"}
          onChange={(agentsMd) => setConfig(withEffective({ ...config, agentsMd }))}
          onSave={() => void saveAgentsMd()}
          description="Always-on OpenHands instructions for newly materialized sandbox config."
        />
      )}
      {activeTab === "skills" && (
        <SkillsTable
          skills={config.skills}
          savingId={savingTarget}
          onChange={(skills) => setConfig(withEffective({ ...config, skills }))}
          onSave={(skill) => void saveSkill(skill)}
        />
      )}
      {activeTab === "agents" && (
        <FileAgentsTable
          agents={config.agents}
          savingId={savingTarget}
          onChange={(agents) => setConfig(withEffective({ ...config, agents }))}
          onSave={(agent) => void saveAgent(agent)}
        />
      )}
    </>
  ) : (
    <div className="flex min-h-80 items-center justify-center rounded-lg border border-border bg-background text-sm text-muted-foreground">
      {loading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading agent config...
        </span>
      ) : (
        "Agent config is unavailable."
      )}
    </div>
  );

  return (
    <AgentConfigShell
      title="Agent config"
      description="Manage workspace OpenHands instructions, reusable skills, and file-based agents before they are resolved into project sandboxes."
      activeTab={activeTab}
      onTabChange={setActiveTab}
      status={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft />
              Projects
            </Link>
          </Button>
          {savedAt && (
            <Badge variant="success">
              <CheckCircle2 className="size-3.5" />
              Saved {savedAt}
            </Badge>
          )}
          {error && (
            <Badge variant="destructive" className="max-w-sm">
              <AlertTriangle className="size-3.5" />
              <span className="truncate">{error}</span>
            </Badge>
          )}
        </div>
      }
      stack={
        <InheritanceStack
          skillsEnabled={enabledSkills}
          agentsEnabled={enabledAgents}
          filesCount={1 + enabledSkills + enabledAgents}
        />
      }
      main={main}
      preview={<EffectiveConfigPreview effective={effective} className="min-h-[42rem]" />}
    />
  );
}
