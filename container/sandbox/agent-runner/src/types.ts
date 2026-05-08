import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export interface TurnRequest {
  sessionId: string;
  providerSessionId: string;
  resumeRequested: boolean;
  prompt: string;
  attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>;
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  allowedTools?: string[];
  agents?: Record<string, AgentDefinition>;
  skills?: "all" | string[];
  mcpServers?: Record<string, unknown>;
  modelId?: string;
  systemPromptAppend?: string;
  turnId: string;
}

export interface BuildServerOptions {
  hmacSecret: string;
  agentContextDir?: string; // default /opt/agent-context
  workspaceDir?: string; // default /workspace
}
