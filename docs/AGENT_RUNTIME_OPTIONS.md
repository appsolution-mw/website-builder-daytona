# Agent Runtime Options

Stand: 2026-04-23.

## Ziel

Die bestehende Claude-Code-Containerloesung bleibt der Default. Zusaetzlich kann
der Broker ueber `AGENT_RUNTIME` auf eine zweite Runtime umgestellt werden.

```env
AGENT_RUNTIME=claude-code
# or
AGENT_RUNTIME=openai-codex
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
CODEX_NETWORK_ACCESS=0
```

Hinweise:

- Die vorhandene `claudeSessionId` wird vorerst als generische Session-ID fuer
  den Broker-Cache weiterverwendet. Das vermeidet eine Prisma-/UI-Migration.
- Codex-Thread-Resume ist aktuell pro laufendem Broker-Prozess gecached. Eine
  spaetere Migration sollte `claudeSessionId` in `agentSessionId` umbenennen und
  provider-spezifische Thread-IDs speichern.
- Kosten werden bei Codex vorerst als `0` gemeldet, weil der SDK Token-Nutzung,
  aber keine fertig bepreisten Turn-Kosten liefert.

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
