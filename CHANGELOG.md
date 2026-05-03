# CHANGELOG

Projektänderungen werden nach Task-ID gruppiert. Dieses Changelog fasst
abgeschlossene logische Arbeit zusammen und listet bewusst nicht jeden
Einzelcommit.

## 2026-05-04

### T-20260504-008 - Projekt-Env-Editor in der Workspace-UI sichtbarer gemacht

- `Env`-Button zusätzlich in die Preview-Toolbar aufgenommen, damit
  projektbezogene `.env`-Variablen ohne Wechsel in den Code-Tab auffindbar sind.
- Lokale Host-Datenbank um die fehlende `ProjectEnvironment`-Tabelle ergänzt,
  damit Speichern der Projekt-Env funktioniert.

### T-20260504-007 - Next-Devtools-Dateien für `src/app`-Repos korrigiert

- Devtools-Dateipfade erkennen nun, ob ein Projekt `src/app/layout.tsx` oder
  `app/layout.tsx` verwendet.
- Workspace-Devtools schreiben die CSS-Datei in denselben App-Root wie das
  Layout, statt bei `src/app`-Repos ein störendes Top-Level-`app/` anzulegen.
- Regressionstests für beide App-Root-Varianten ergänzt.
- Die laufende Paramount-Sandbox wurde bereinigt und die Preview wieder gegen
  `src/app` gestartet.

### T-20260504-006 - GitHub-Repo-Quelle im lokalen Worker-Sandbox-Start korrigiert

- Root Cause untersucht: alte globale GitHub-Clone-Env-Werte überschrieben die
  projektspezifische Repo-Auswahl beim lokalen Worker-Sandbox-Start.
- Worker-Pool-Runtime so angepasst, dass die gewählte Projektquelle Vorrang vor
  legacy Broker-Env-Werten hat.
- Regressionstest für diesen Env-Precedence-Fall ergänzt.
- Lokales Sandbox-Image neu gebaut und das Paramount-Projekt aus dem gewählten
  GitHub-Repo neu gespawnt.

### T-20260504-005 - GitHub-Login ohne öffentliche E-Mail stabilisiert

- `email_not_found` beim GitHub-OAuth-Callback untersucht und auf fehlende
  E-Mail im GitHub-Profil zurückgeführt.
- Better-Auth-GitHub-Profilmapping ergänzt, das bei privater GitHub-E-Mail eine
  stabile interne Noreply-Adresse erzeugt.
- Regressionstest für echte und fehlende GitHub-E-Mails ergänzt.

### T-20260504-003 - GitHub-Repo-Import für lokalen Docker-Worker-Pool umgesetzt

- Better Auth mit GitHub-Login, Session-Proxy und user-scoped Projekt-Routen
  ergänzt.
- GitHub-App-Installationen, Repository- und Branch-Auswahl über Host-APIs und
  Dashboard-UI angebunden.
- Projekte können GitHub-Repos als Quelle speichern und `worker-pool-local`
  startet die Sandbox aus dem gewählten Branch mit kurzlebigem
  Installation-Token.
- Sandbox-Entrypoint klont GitHub-Repos, entfernt Token aus der Remote-URL,
  erkennt Package Manager und startet den Dev-Server im eigenen Docker-Service.
- PR-Saveback ist als `T-20260504-004` separat geplant.

### T-20260504-002 - GitHub-Auth-Env-Platzhalter ergänzt

- Better-Auth- und GitHub-App-Platzhalter in `.env.example` dokumentiert.
- Dieselben leeren Platzhalter lokal in `.env` ergänzt, ohne echte
  Secret-Werte einzutragen.

### T-20260504-001 - Turbopack-NFT-Warnung behoben

- Dynamisches Worker-Pool-Env-Dateitracing für Turbopack markiert.
- Fake-Daytona-Runtime aus dem statischen App-Route-Bundlepfad gelöst und nur
  noch lazy geladen.
- `pnpm build` läuft ohne die vorherige Turbopack-NFT-Warnung.

## 2026-05-03

### T-20260503-007 - Projekt-Env-Verwaltung umgesetzt

- Dauerhafte projektbezogene dotenv-Persistenz mit Prisma-Modell, Migration und
  gecachter-freier Projekt-Env-API ergänzt.
- Sandbox-Spawns über Worker-Pool, Daytona Cloud und Fake-Runtime um
  `.env`-Synchronisierung erweitert; Secrets werden nicht in initiale
  Sandbox-Git-Commits oder Provisioning-Fehler übernommen.
- Workspace um ein Env-Panel ergänzt, das per Textfeld speichert, die laufende
  Sandbox über den bestehenden Broker-Dateischreibpfad synchronisiert und
  Sync-Fehler retrybar hält.

### T-20260503-006 - Implementation-Plan für GitHub-Auth-Integration erstellt

- Implementation-Plan für Better Auth, GitHub App, private Repo-Imports,
  Sandbox-Boot aus Branches und PR-Erstellung ergänzt.
- Taskfolge mit Sub-Agent-Schnitten, Datei-Zuständigkeiten, Testschritten und
  Commit-Grenzen dokumentiert.
- Next.js-16-Route-Handler-/Proxy-Hinweise und die freigegebene Design-Spec als
  Planungsgrundlage referenziert.

### T-20260503-005 - Better-Auth- und GitHub-App-Integration geplant

- Design-Spec für Email/Passwort-Login, GitHub Social Login und Better Auth
  erstellt.
- GitHub App als Repo-Zugriffsschicht für persönliche Accounts und
  Organisationen festgelegt.
- Repo-Import, Sandbox-Boot aus Branch und Branch-/Commit-/PR-Flow als erster
  produktiver Milestone abgegrenzt.

### T-20260503-004 - Sub-Agent-Delegation und Reasoning-Auswahl präzisiert

- `AGENTS.md` um eine klare Sub-Agent-Delegationsregel ergänzt.
- Kriterien ergänzt, wann Arbeit lokal bleiben soll und wann sie auf
  Sub-Agents verteilt werden muss.
- Reasoning-Auswahl pro Sub-Agent mit `medium` und `high` nach Komplexität,
  Risiko und benötigtem Urteilsvermögen definiert.

### T-20260503-003 - Task-Journal und Changelog backfilled

- `TASKS.md` anhand Git-Tags, Git-Commits und `docs/superpowers` als strukturelle
  Übersicht neu aufgebaut.
- Abgeschlossene Phasen und größere Git-Blöcke von 2026-04-22 bis 2026-05-03
  mit Plan-/Spec-Verweisen und Git-Evidenz ergänzt.
- `AGENTS.md` um Regeln für kompakte Task-Tabellen und rückwirkend
  rekonstruierte Aufgaben erweitert.

### T-20260503-002 - Projektlokalen Codex Git-Commit-Agent konfiguriert

- `.codex/config.toml` und `.codex/agents/git-commit-manager.toml` ergänzt.
- Commit-Agent-Wording auf `website-builder-daytona` angepasst.

### T-20260503-001 - Projektweites Task-Journal und Changelog eingeführt

- `TASKS.md` als kanonisches Task-Journal mit stabilen Task-IDs ergänzt.
- `CHANGELOG.md` für knappe Completed-Work-Zusammenfassungen ergänzt.
- `AGENTS.md` um projektbezogene Workflow-, Verification-, Git-, Next.js- und
  Runtime-Regeln erweitert.

## 2026-04-30

### T-20260430-001 - Runtime-, Worker-Pool- und Test-Stabilisierung abgeschlossen

- DB-Tests isoliert, Modellfilter stabilisiert und orphan sandbox cleanup
  ergänzt.
- Konfigurierte lokale Worker-Agent-URL berücksichtigt und Docker-Port-Reuse
  vermieden.
- HMAC-Testassertions vereinfacht, Sandbox-Agent-Instructions backfilled und
  lokale Worktree-Artefakte in ESLint ignoriert.

## 2026-04-29

### T-20260429-002 - Globale OpenHands Library umgesetzt

- Library-Datenmodell, Revision-Service, Import/Export und API-Routen ergänzt.
- Session-Snapshots, OpenHands-Snapshot-Rendering und Preset-Auswahl integriert.
- Library Management UI und Editor UI ergänzt sowie Snapshot-/Preset-Flows
  gehärtet.

### T-20260429-001 - OpenHands-Runtime und OpenRouter-Model-Picker integriert

- OpenHands als Agent-Runtime ergänzt und OpenRouter-Modellkatalog bereitgestellt.
- Searchable Model Picker, Python Bridge und OpenHands Broker Provider ergänzt.
- Runtime-Dokumentation und Build-/Test-Stabilisierungen für OpenHands ergänzt.

## 2026-04-28

### T-20260428-004 - H.1b-Abschluss und Übergabe dokumentiert

- Handover für Phase H.1b zu H.1c mit aktuellem Stand, Verification Evidence,
  Follow-ups und Guardrails ergänzt.

### T-20260428-003 - Phase H.1b Sandbox-Image, Worker-Agent und LocalDocker-Runtime umgesetzt

- `worker-agent` Workspace Package mit HMAC, Docker-Lifecycle, HTTP-Routen,
  Heartbeat und lokalen Startskripten ergänzt.
- Pre-built Sandbox-Image, Sandbox-Entrypoint, AgentClient und WorkerPoolRuntime
  umgesetzt.
- `worker-pool-local` in die Runtime Factory verdrahtet und CI-Workflows für
  Sandbox-Image und Worker-Agent ergänzt.

### T-20260428-002 - Phase H.1a Foundation umgesetzt

- Worker-/Sandbox-/Token-Prisma-Modelle ergänzt.
- Runtime-, Scheduler- und WorkerProvisioner-Abstraktionen eingeführt.
- Daytona-Runtime verschoben/adaptiert, FakeProvisioner, SimpleScheduler und
  `createRuntime` umgesetzt.

### T-20260428-001 - Phase H.1 Hetzner-/Multi-Cloud-Runtime spezifiziert

- Design-Spec für Worker-Pool, Provisioning, Scheduler, Sandbox-Lifecycle,
  Testing und Sub-Phasen ergänzt.

## 2026-04-23

### T-20260423-003 - Multi-Runtime-Broker und runtime-aware Workspace-Chat ergänzt

- Multi-Runtime-Broker-Support, persisted runtime state und runtime-aware
  Workspace Chat umgesetzt.
- Daytona-Preview-Warnung unterdrückt.

### T-20260423-002 - OpenAI-Codex-Agent-Runtime ergänzt

- OpenAI Codex als Agent-Runtime ergänzt.
- Agent-Runtime-Konfiguration dokumentiert.

### T-20260423-001 - Claude-Sessions und Usage-Telemetrie persistiert

- Claude-Sessions und Usage-Flows persistiert.
- Tests und Dokumentation für Claude Auth und knappe Agent-Ausgabe ergänzt.

## 2026-04-22

### T-20260422-006 - Phase 1.2b Multi-Agent-Team umgesetzt

- Agent-Rollen und Orchestrator-Anweisungen ergänzt.
- `agentId`-Tagging, Reviewer-Pass und auto-review nach file-writing turns
  umgesetzt.
- Per-agent Chat Bubbles und Reviewing-Indikator ergänzt.

### T-20260422-005 - Dashboard- und Workspace-UI aufgefrischt

- Lokale shadcn-orientierte UI-Primitives ergänzt.
- Dashboard- und Workspace-Oberflächen überarbeitet.

### T-20260422-004 - Phase 1.3 Editor Layer umgesetzt

- `file.list`, `file.read`, `file.write` und `file.changed` im Protokoll
  ergänzt.
- Chokidar-basierte File-Tracking- und Broker-Handler umgesetzt.
- Monaco-Editor, File Tree, Markdown Chat Message und Soft-Lock-Integration in
  den Workspace eingebaut.

### T-20260422-003 - Phase 1.2 Claude-Code-Agent umgesetzt

- `agent.prompt`, Streaming-Events, Tool-Events, Done/Error-Events und
  Abort/Timeout-Flows ergänzt.
- Claude Runner, NDJSON Parser und Workspace Prompt UI umgesetzt.
- Fake-mode Agent-Flow getestet.

### T-20260422-002 - Phase 1.1 Daytona-Integration umgesetzt

- Daytona SDK, Fake-/Cloud-Client, Sandbox-Felder und Container-Template ergänzt.
- Projekt-Create/Delete-Flows mit Sandbox-Lifecycle verbunden.
- Dashboard-Status, Provisioning-Polling, Preview-Iframe und Fake-mode
  Integrationstest ergänzt.

### T-20260422-001 - Phase 1.0 Broker Hello umgesetzt

- Next.js Host, Prisma-Basis, Broker-Lifecycle und Ping/Pong-Protokoll ergänzt.
- WS-Proxy, Project API, Dashboard und Workspace-Ping-Test umgesetzt.
- Dev-Start über gemeinsam gestartete Host-/Broker-/Proxy-Prozesse ergänzt.
