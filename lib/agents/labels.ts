const KNOWN: Record<string, string> = {
  planner: "Planner",
  explorer: "Explorer",
  "coder-claude": "Coder",
  reviewer: "Reviewer",
};

export function summariseAgentLabel(agentId: string | undefined): string {
  if (!agentId) return "Orchestrator";
  return KNOWN[agentId] ?? agentId;
}
