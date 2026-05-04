# Agent Runtime Options

Stand: 2026-04-29.

## Ziel

Die bestehende Claude-Code-Containerloesung bleibt der Default. Zusaetzlich kann
der Broker ueber `AGENT_RUNTIME` auf weitere Runtimes umgestellt werden.

```env
AGENT_RUNTIME=claude-code
# or
AGENT_RUNTIME=openai-codex
# or
AGENT_RUNTIME=openhands
```

## Bestehende Architektur

Der Browser sendet `agent.prompt` an den `ws-proxy`, der an den Broker im
Daytona-Container weiterleitet. Der Broker startet bisher `claude --print` und
uebersetzt Claude-Code-NDJSON in die bestehenden `agent.*` Events.

Wichtige Dateien:

- `container/broker/src/ws-server.ts`: WebSocket-Protokoll und Turn-Lifecycle
- `container/broker/src/claude-runner.ts`: bestehender Claude-Code-Runner
- `container/broker/src/ndjson-parser.ts`: Claude-Code-Stream-Adapter
- `lib/runtime/daytona/cloud.ts`: Container-Env und Bootstrapping
- `packages/protocol/src/index.ts`: geteiltes Browser/Broker-Protokoll

## Eingebaute Optionen

### `claude-code`

Default und bestehender Pfad. Der Container installiert weiterhin
`@anthropic-ai/claude-code`, nutzt `claude --print --output-format stream-json`
und fuehrt nach Schreiboperationen den vorhandenen Reviewer-Pass aus.

Konfiguration ueber OpenRouter:

```env
AGENT_RUNTIME=claude-code
OPENROUTER_API_KEY=sk-or-v1-...
ANTHROPIC_BASE_URL=https://openrouter.ai/api
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_REVIEWER_MODEL=claude-sonnet-4-6
```

Der Broker startet weiterhin die Claude Code CLI. Wenn `OPENROUTER_API_KEY`
gesetzt ist und `ANTHROPIC_API_KEY` leer bleibt, setzt der Runtime-Layer fuer
den Claude-Code-Prozess automatisch `ANTHROPIC_API_KEY=OPENROUTER_API_KEY` und
`ANTHROPIC_BASE_URL=https://openrouter.ai/api`. Damit spricht Claude Code gegen
OpenRouter's Anthropic-kompatible API, ohne den CLI-Pfad zu ersetzen. Wer direkt
ein Anthropic-Konto verwenden will, setzt stattdessen `ANTHROPIC_API_KEY`; dieser
Wert wird nicht durch `OPENROUTER_API_KEY` ueberschrieben. Fuer direkte
Anthropic-Nutzung muss `ANTHROPIC_BASE_URL` leer bleiben. Bei OpenRouter-Spawns
entfernt der Broker `CLAUDE_CODE_OAUTH_TOKEN` aus der Child-Process-Umgebung,
damit Claude Code nicht versehentlich OAuth statt des Gateway-API-Keys nutzt.

Vorteile:

- Reifste Coding-Agent-Funktionalitaet in diesem Projekt
- Bestehende `.claude/agents`, Subagents und Claude-Code-Skills bleiben nutzbar
- Bestehende Token-/Cost-Auswertung bleibt erhalten

Nachteile:

- Stark an Claude Code und dessen NDJSON-Format gekoppelt
- Container-Auth/OAuth/API-Key-Verhalten bleibt empfindlich

### `openai-codex`

Neue zweite Runtime via `@openai/codex-sdk`. Der SDK wickelt den Codex CLI ab,
streamt strukturierte JSONL-Events und bringt Coding-Agent-Faehigkeiten wie
Shell, Dateioperationen, MCP, Skills und Thread-Kontext mit.

Konfiguration:

```env
AGENT_RUNTIME=openai-codex
CODEX_API_KEY=...
# fallback:
OPENAI_API_KEY=...
CODEX_MODEL=gpt-5.4
CODEX_REVIEWER_MODEL=gpt-5.4
CODEX_REASONING_EFFORT=medium
CODEX_REVIEWER_REASONING_EFFORT=high
CODEX_SANDBOX_MODE=danger-full-access
CODEX_REVIEWER_SANDBOX_MODE=danger-full-access
CODEX_NETWORK_ACCESS=0
```

Hinweise:

- Die vorhandene `claudeSessionId` wird vorerst als generische Session-ID fuer
  den Broker-Cache weiterverwendet. Das vermeidet eine Prisma-/UI-Migration.
- `danger-full-access` vermeidet Codex' innere `bwrap`-Sandbox. Das ist fuer
  Daytona-/Worker-Container der robuste Default, weil die aeussere Projekt-
  isolation bereits durch den Container kommt. Auf Hosts mit funktionierenden
  unprivileged user namespaces kann `CODEX_SANDBOX_MODE=workspace-write` oder
  `CODEX_REVIEWER_SANDBOX_MODE=read-only` gesetzt werden.
- Codex-Thread-Resume ist aktuell pro laufendem Broker-Prozess gecached. Eine
  spaetere Migration sollte `claudeSessionId` in `agentSessionId` umbenennen und
  provider-spezifische Thread-IDs speichern.
- Kosten werden bei Codex vorerst als `0` gemeldet, weil der SDK Token-Nutzung,
  aber keine fertig bepreisten Turn-Kosten liefert.

### `openhands`

Neue Runtime ueber die lokale Python-Bridge fuer OpenHands. Der TypeScript-
Broker bleibt der Prozess-Owner im Container, startet aber fuer Turns den
OpenHands-Python-Pfad und uebersetzt dessen Ergebnisse wieder in die
bestehenden `agent.*` Events. Damit kann die Browser-/Broker-Architektur
unveraendert bleiben, waehrend OpenHands die eigentliche Coding-Agent-Schicht
stellt.

Konfiguration:

```env
AGENT_RUNTIME=openhands
OPENROUTER_API_KEY=sk-or-v1-...
OPENHANDS_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_REVIEWER_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_BASE_URL=https://openrouter.ai/api/v1
OPENHANDS_MAX_ITERATIONS=30
OPENHANDS_ENABLE_PUBLIC_SKILLS=0
# optional generic LiteLLM-compatible env:
LLM_API_KEY=sk-or-v1-...
LLM_BASE_URL=https://openrouter.ai/api/v1
```

Hinweise:

- Model-IDs kommen bevorzugt aus der UI bzw. aus
  `SessionRuntimeState.modelId`. Wenn dort kein Wert gesetzt ist, nutzt der
  Broker `OPENHANDS_MODEL`; fuer Reviewer-Turns entsprechend
  `OPENHANDS_REVIEWER_MODEL`.
- OpenRouter-Modelle werden als vollstaendige OpenHands/LiteLLM-IDs angegeben,
  z.B. `openrouter:qwen/qwen3-coder:free`. `OPENHANDS_BASE_URL` zeigt fuer
  OpenRouter auf `https://openrouter.ai/api/v1`.
- `OPENHANDS_MAX_ITERATIONS` begrenzt die Anzahl Agent-Schritte pro Turn.
  `OPENHANDS_ENABLE_PUBLIC_SKILLS=0` ist der konservative Default fuer
  reproduzierbare Sandbox-Laeufe; bei `1` darf OpenHands zusaetzliche
  oeffentliche Skills verwenden.
- Projektkontext kommt weiterhin aus `AGENTS.md`. Die Host-UI verwaltet dafür
  eine globale Konfiguration und eine Projektkonfiguration mit `INHERIT`,
  `EXTEND` oder `REPLACE`; beim Sandbox-Start wird daraus die effektive
  `AGENTS.md` materialisiert.
- Skills werden über die Host-UI global gepflegt und pro Projekt aktiviert,
  deaktiviert oder geerbt. Aktivierte Skills werden beim Sandbox-Start nach
  `.agents/skills/<name>/SKILL.md` geschrieben. Der ältere Pfad
  `.openhands/skills` bleibt nur als Legacy-Fallback relevant.
- File-basierte Agents bleiben ein guter Weg, projektspezifische Rollen,
  Review-Regeln und Spezialfähigkeiten zu halten. Aktivierte Agents werden als
  `.agents/agents/<name>.md` materialisiert und können ebenfalls global oder
  pro Projekt aktiviert, deaktiviert oder geerbt werden.
- Sub-Agents und Delegation laufen in OpenHands ueber dessen Agent-/Skill-
  Mechanismen. Wo verfuegbar, nutzt die Runtime den `DelegateTool` fuer
  abgegrenzte Teilaufgaben statt alles in einem langen Haupt-Turn zu halten.

## Recherchierte Optionen

### Vercel AI SDK

Sehr gut fuer TypeScript/Next.js-Streaming, Provider-Abstraktion, Tool Calling
und Agent-Loops (`stopWhen`, `prepareStep`, Agent-Abstraktion). Als Ersatz fuer
Claude Code reicht es allein nicht aus: Filesystem-, Shell-, Patch-, Skill- und
Sandbox-Faehigkeiten muessten als eigene Tools oder ueber MCP gebaut werden.

Empfehlung: spaeter als UI-/Orchestrierungsschicht pruefen, nicht als erster
Coding-Agent-Ersatz im Container.

### OpenAI Codex SDK

Beste erste Alternative fuer dieses Projekt. Der SDK ist TypeScript-first,
wrappt den Codex CLI, bietet Streaming-Events, Thread-Resume, strukturierte
Outputs, Working-Directory-Kontrolle und ist speziell fuer Coding-Agenten
gebaut.

### OpenAI Agents SDK / Responses API

Sehr gute Basis, wenn wir den kompletten Harness selbst bauen wollen:
Tool-Calls, MCP, Handoffs, Sessions, Tracing, Guardrails und OpenAI-Tools wie
Shell/Apply Patch. Fuer einen schnellen Drop-in im bestehenden TypeScript-Broker
ist Codex SDK naeher an der aktuellen Claude-Code-Architektur.

### Claude Agent SDK

Technisch am naechsten an Claude Code als Library, inklusive Skills, Tools,
Subagents und Sessions. Als Alternative zur aktuellen Loesung ist es aber eher
eine Claude-Code-Refaktorierung als ein zweiter Anbieter.

### OpenHands SDK, LangGraph/Deep Agents, Mastra

Interessant fuer groessere Orchestrierung, Workflows, Langzeit-State,
Subagenten und eigene Toolchains. Fuer den aktuellen Wunsch nach schnell
umschaltbaren Coding-Runtimes im Container sind sie groesser als noetig.

## Naechster sinnvoller Schritt

Wenn `openai-codex` im Daytona-Container stabil laeuft, sollte die Session-
Kopplung entclaudifiziert werden:

1. `claudeSessionId` im Protocol zusaetzlich als `agentSessionId` akzeptieren.
2. Prisma-Feld migrieren oder ein Provider-Session-Mapping einfuehren.
3. UI-Auswahl fuer Runtime pro Projekt oder Session ergaenzen.
4. Token-/Kostenberechnung provider-spezifisch normalisieren.
