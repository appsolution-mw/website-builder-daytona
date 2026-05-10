# Daytona SDK API Notes

> **Purpose:** Reference for Phase 1.1 Tasks 2–15. Verified against `@daytona/sdk@0.168.0`
> installed 2026-04-22. Sources: official docs (daytona.io) + on-disk `.d.ts` files
> (authoritative). The `.d.ts` files take precedence over any doc page content.

---

## Installation

```bash
pnpm add @daytona/sdk -w   # workspace root flag required
```

Installed version: `@daytona/sdk@0.168.0`

```
website-builder-daytona@0.1.0
└── @daytona/sdk@0.168.0
```

The package ships **source alongside declarations** — all types live in
`node_modules/@daytona/sdk/src/*.d.ts`; there is no separate `dist/` directory.

---

## Constructor

```typescript
import { Daytona } from "@daytona/sdk";

// Explicit config
const daytona = new Daytona({
  apiKey?: string;           // or use env var DAYTONA_API_KEY
  jwtToken?: string;         // alternative to apiKey; needs organizationId
  organizationId?: string;   // required when using jwtToken
  apiUrl?: string;           // defaults to https://app.daytona.io/api; or DAYTONA_API_URL
  serverUrl?: string;        // @deprecated — use apiUrl instead
  target?: string;           // geographic target, e.g. "us"; or DAYTONA_TARGET
  _experimental?: Record<string, any>;
});

// Zero-arg form reads all from env vars
const daytona = new Daytona();
```

Note: `otelEnabled` appears in the JSDoc examples in `Daytona.d.ts` but is **not** declared
in the `DaytonaConfig` interface — it may be handled via `_experimental` or is undocumented.

---

## `daytona.create()` Options

There are **two overloaded signatures** depending on whether you supply an `image` or a `snapshot`:

### Variant A — from image

```typescript
daytona.create(
  params?: CreateSandboxFromImageParams,
  options?: {
    timeout?: number;                         // seconds; 0 = no timeout; default 60
    onSnapshotCreateLogs?: (chunk: string) => void;
  }
): Promise<Sandbox>
```

```typescript
type CreateSandboxFromImageParams = CreateSandboxBaseParams & {
  image: string | Image;   // OCI image URI or declarative Image object (required for this variant)
  resources?: Resources;   // { cpu?, gpu?, memory?, disk? }
};
```

### Variant B — from snapshot (default)

```typescript
daytona.create(
  params?: CreateSandboxFromSnapshotParams,
  options?: {
    timeout?: number;   // seconds; 0 = no timeout; default 60
  }
): Promise<Sandbox>
```

```typescript
type CreateSandboxFromSnapshotParams = CreateSandboxBaseParams & {
  snapshot?: string;   // Snapshot ID or name (optional — uses default snapshot if omitted)
};
```

### Shared base params (`CreateSandboxBaseParams`)

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Optional custom identifier |
| `user` | `string` | OS user inside the sandbox |
| `language` | `CodeLanguage \| string` | `"python"` / `"typescript"` / `"javascript"` |
| `envVars` | `Record<string, string>` | Runtime environment variables |
| `labels` | `Record<string, string>` | Key-value metadata |
| **`public`** | **`boolean`** | **Whether port previews are publicly accessible (unauthenticated)** |
| `autoStopInterval` | `number` | Minutes of inactivity before auto-stop (default: 15; 0 = disabled) |
| `autoArchiveInterval` | `number` | Minutes stopped before archiving (default: 7 days; 0 = max) |
| `autoDeleteInterval` | `number` | Minutes stopped before deletion (negative = disabled; 0 = immediate on stop) |
| `volumes` | `VolumeMount[]` | Volume mounts |
| `networkBlockAll` | `boolean` | Block all outbound network |
| `networkAllowList` | `string` | Comma-separated allowed CIDR ranges |
| `ephemeral` | `boolean` | Sets `autoDeleteInterval=0` |

### Resources (`Resources`)

```typescript
interface Resources {
  cpu?: number;     // vCPU cores
  gpu?: number;     // GPU units
  memory?: number;  // GiB RAM
  disk?: number;    // GiB disk
}
```

### MISSING: inline startup command / entrypoint option

**There is NO `command`, `entrypoint`, or `startupScript` option in `create()`.**

The API surface does not support passing an inline shell command to run at container
boot time. To run a command at startup, the recommended pattern is:

1. Pass `image: "your-image"` where the `ENTRYPOINT`/`CMD` is baked in, OR
2. Call `sandbox.process.executeCommand(cmd)` immediately after `create()` returns,
   OR
3. Use `sandbox.process.createSession(id)` + `executeSessionCommand()` for
   stateful multi-step init, OR
4. Inspect `sandbox.process.getEntrypointSession()` / `getEntrypointLogs()` to
   see what the image's own entrypoint did.

**Impact for Task 8:** The broker startup command must be encoded in the Docker image
itself (via `CMD`/`ENTRYPOINT`), or triggered immediately post-create via
`sandbox.process.executeCommand()`.

---

## Waiting for RUNNING State

`daytona.create()` already **blocks until the sandbox reaches `started` state** before
returning (using the `timeout` option, default 60 s).

For cases where you hold a reference to a not-yet-started sandbox, both methods are available:

```typescript
// On Sandbox instance:
await sandbox.waitUntilStarted(timeout?: number): Promise<void>
// timeout in seconds; 0 = no timeout; default 60 s
// Throws DaytonaError if sandbox reaches error state or times out.

await sandbox.waitUntilStopped(timeout?: number): Promise<void>

// On Daytona client:
await daytona.start(sandbox, timeout?: number): Promise<void>
```

State is exposed as `sandbox.state: SandboxState` (see SandboxState enum below).
Call `await sandbox.refreshData()` to re-fetch state from the API.

---

## Preview Links

### Standard preview link

```typescript
const link: PortPreviewUrl = await sandbox.getPreviewLink(port: number): Promise<PortPreviewUrl>
```

```typescript
interface PortPreviewUrl {
  sandboxId: string;
  url: string;     // the preview URL
  token: string;   // access token for private sandboxes
}
```

For **private** sandboxes (`public: false` / default), the token must be supplied as the
`x-daytona-preview-token` HTTP header. The token resets when the sandbox restarts.

### Signed preview link (iframe-safe)

```typescript
const signed: SignedPortPreviewUrl = await sandbox.getSignedPreviewUrl(
  port: number,
  expiresInSeconds?: number   // 1–86400; default 60 s
): Promise<SignedPortPreviewUrl>

interface SignedPortPreviewUrl {
  sandboxId: string;
  port: number;
  token: string;
  url: string;   // token embedded in the URL itself
}

// Explicitly expire a signed URL before its natural expiry:
await sandbox.expireSignedPreviewUrl(port: number, token: string): Promise<void>
```

The signed URL embeds the token in the URL path (`https://{port}-{token}.{domain}`),
so no custom HTTP headers are needed.

---

## Critical: Can iframes access preview URLs without a token header?

**Answer: YES, but only via signed preview URLs or public sandboxes.**

- **Private sandbox + `getPreviewLink()`**: The browser iframe **cannot** inject the
  `x-daytona-preview-token` header. An iframe pointing at the raw `url` will be
  rejected (401/403). **This approach does NOT work for iframes.**

- **`getSignedPreviewUrl()`**: The token is part of the URL itself. An iframe can load
  this URL without any extra headers. **This is the correct approach for Task 13's
  iframe plan.** Note: default expiry is 60 s — Task 13 must refresh the signed URL
  periodically (e.g. every 30 s) or use a longer `expiresInSeconds` value.

- **`public: true` sandbox**: All preview URLs become publicly accessible without any
  token. Simpler for development/demos but exposes the preview to anyone who knows the
  URL. Suitable only if the sandbox content is not sensitive.

**Recommendation for Task 13:** Use `getSignedPreviewUrl(3000, 3600)` (1-hour expiry)
and embed the resulting `url` directly in the iframe `src`. Refresh before expiry.

---

## Sandbox Deletion / Destroy

The method is **`delete()`** — there is no `destroy()` method.

```typescript
// On Sandbox instance:
await sandbox.delete(timeout?: number): Promise<void>
// timeout in seconds; 0 = no timeout; default 60 s

// On Daytona client:
await daytona.delete(sandbox: Sandbox, timeout?: number): Promise<void>
```

**Idempotency:** The `Sandbox.d.ts` contains a private `refreshDataSafe()` that
"does not throw an error if the sandbox has been deleted — instead sets state to
destroyed." This suggests the SDK handles already-deleted sandboxes gracefully,
but the public `delete()` method's idempotency is not explicitly documented.
Task 8 should wrap calls in a try/catch for safety.

---

## Process / Command Execution

```typescript
// One-shot command:
const resp: ExecuteResponse = await sandbox.process.executeCommand(
  command: string,
  cwd?: string,
  env?: Record<string, string>,
  timeout?: number   // seconds
): Promise<ExecuteResponse>

// ExecuteResponse shape:
{
  exitCode: number;
  result: string;           // stdout
  artifacts: {
    stdout: string;         // same as result
    charts?: ...;           // matplotlib charts metadata (Python only)
  }
}

// Stateful session (persists env between commands):
await sandbox.process.createSession(sessionId: string): Promise<void>
await sandbox.process.executeSessionCommand(sessionId, {
  command: string,
  runAsync?: boolean,
  suppressInputEcho?: boolean
}, timeout?: number): Promise<SessionExecuteResponse>
// Returns: { cmdId, output, stdout, stderr, exitCode }

await sandbox.process.deleteSession(sessionId: string): Promise<void>

// Entrypoint session (the image CMD/ENTRYPOINT process):
const session = await sandbox.process.getEntrypointSession(): Promise<Session>
const logs = await sandbox.process.getEntrypointLogs(): Promise<SessionCommandLogsResponse>
// Streaming variant:
await sandbox.process.getEntrypointLogs(onStdout, onStderr): Promise<void>

// PTY / interactive terminal:
const ptyHandle = await sandbox.process.createPty(options?: PtyCreateOptions & PtyConnectOptions)
```

**Startup script pattern for Task 8:**
Since `create()` has no `command` option, the broker init script should be executed
immediately after creation:

```typescript
const sandbox = await daytona.create({ image: "...", envVars: { ... } });
await sandbox.process.executeCommand("/usr/local/bin/start-broker.sh");
```

Or embed the script in the Docker image `CMD`.

---

## SandboxState Enum

From `@daytona/api-client` (re-exported by `@daytona/sdk`):

```typescript
const SandboxState = {
  CREATING:          "creating",
  RESTORING:         "restoring",
  DESTROYED:         "destroyed",   // note: NOT "deleted"
  DESTROYING:        "destroying",
  STARTED:           "started",     // the RUNNING state — check for this
  STOPPED:           "stopped",
  STARTING:          "starting",
  STOPPING:          "stopping",
  ERROR:             "error",
  BUILD_FAILED:      "build_failed",
  PENDING_BUILD:     "pending_build",
  BUILDING_SNAPSHOT: "building_snapshot",
  UNKNOWN:           "unknown",
  PULLING_SNAPSHOT:  "pulling_snapshot",
  ARCHIVED:          "archived",
  ARCHIVING:         "archiving",
  RESIZING:          "resizing",
  SNAPSHOTTING:      "snapshotting",
  FORKING:           "forking",
};
```

**Important:** The "running" state string is `"started"` (not `"running"`).
The spec's assumption of `RUNNING` is incorrect — use `SandboxState.STARTED`.

---

## Other Notable APIs

```typescript
// List sandboxes by label (useful for finding existing project sandbox):
const result = await daytona.list(
  labels?: Record<string, string>,
  page?: number,
  limit?: number
): Promise<PaginatedSandboxes>

// Get by ID or name:
const sandbox = await daytona.get(sandboxIdOrName: string): Promise<Sandbox>

// Lifecycle:
await sandbox.start(timeout?: number): Promise<void>
await sandbox.stop(timeout?: number, force?: boolean): Promise<void>
await sandbox.archive(): Promise<void>
await sandbox.recover(timeout?: number): Promise<void>
await sandbox.resize(resources: Resources, timeout?: number): Promise<void>

// Metadata refresh:
await sandbox.refreshData(): Promise<void>
await sandbox.refreshActivity(): Promise<void>

// Auto-stop/archive/delete intervals (settable post-creation):
await sandbox.setAutostopInterval(minutes: number): Promise<void>
await sandbox.setAutoArchiveInterval(minutes: number): Promise<void>
await sandbox.setAutoDeleteInterval(minutes: number): Promise<void>

// SSH access:
await sandbox.createSshAccess(expiresInMinutes?: number): Promise<SshAccessDto>
await sandbox.revokeSshAccess(token: string): Promise<void>
```

---

## Observed Runtime Shape

Script run: `node --env-file=.env daytona-sanity.mjs` (from project root)

```
Daytona constructor: function
Daytona instance prototype keys: []
Own keys: [
  'clientConfig',
  'sandboxApi',
  'objectStorageApi',
  'configApi',
  'target',
  'apiKey',
  'jwtToken',
  'organizationId',
  'apiUrl',
  'otelSdk',
  'volume',
  'snapshot'
]
```

Notes:
- `typeof Daytona === "function"` — constructor is importable and works
- Prototype keys are empty because all methods are declared as class fields in the
  compiled JS (arrow functions), not on the prototype. The `.d.ts` shows them as
  regular methods, but at runtime they live as own instance properties.
- `volume` and `snapshot` are the two public service properties
- No network call was made; the constructor succeeded immediately with env var credentials

---

## Type Definitions (.d.ts excerpts)

### `Daytona` class — `node_modules/@daytona/sdk/src/Daytona.d.ts`

```typescript
export declare class Daytona implements AsyncDisposable {
  readonly volume: VolumeService;
  readonly snapshot: SnapshotService;

  constructor(config?: DaytonaConfig);
  [Symbol.asyncDispose](): Promise<void>;

  create(params?: CreateSandboxFromSnapshotParams, options?: { timeout?: number }): Promise<Sandbox>;
  create(params?: CreateSandboxFromImageParams, options?: {
    onSnapshotCreateLogs?: (chunk: string) => void;
    timeout?: number;
  }): Promise<Sandbox>;

  get(sandboxIdOrName: string): Promise<Sandbox>;
  list(labels?: Record<string, string>, page?: number, limit?: number): Promise<PaginatedSandboxes>;
  start(sandbox: Sandbox, timeout?: number): Promise<void>;
  stop(sandbox: Sandbox): Promise<void>;
  delete(sandbox: Sandbox, timeout?: number): Promise<void>;
  _experimental_fork(sandbox: Sandbox, params?: { name?: string }, timeout?: number): Promise<Sandbox>;
}
```

### `Sandbox` class — `node_modules/@daytona/sdk/src/Sandbox.d.ts` (key members)

```typescript
export declare class Sandbox implements SandboxDto {
  readonly fs: FileSystem;
  readonly git: Git;
  readonly process: Process;
  readonly computerUse: ComputerUse;
  readonly codeInterpreter: CodeInterpreter;

  id: string;
  name: string;
  public: boolean;
  state?: SandboxState;
  cpu: number; gpu: number; memory: number; disk: number;
  env: Record<string, string>;
  labels: Record<string, string>;

  start(timeout?: number): Promise<void>;
  stop(timeout?: number, force?: boolean): Promise<void>;
  delete(timeout?: number): Promise<void>;           // NOTE: delete(), not destroy()
  waitUntilStarted(timeout?: number): Promise<void>;
  waitUntilStopped(timeout?: number): Promise<void>;
  refreshData(): Promise<void>;
  refreshActivity(): Promise<void>;

  getPreviewLink(port: number): Promise<PortPreviewUrl>;
  getSignedPreviewUrl(port: number, expiresInSeconds?: number): Promise<SignedPortPreviewUrl>;
  expireSignedPreviewUrl(port: number, token: string): Promise<void>;

  setAutostopInterval(interval: number): Promise<void>;
  setAutoArchiveInterval(interval: number): Promise<void>;
  setAutoDeleteInterval(interval: number): Promise<void>;
  resize(resources: Resources, timeout?: number): Promise<void>;
  archive(): Promise<void>;
  recover(timeout?: number): Promise<void>;

  getUserHomeDir(): Promise<string | undefined>;
  getWorkDir(): Promise<string | undefined>;
  createSshAccess(expiresInMinutes?: number): Promise<SshAccessDto>;
  _experimental_fork(params?: { name?: string }, timeout?: number): Promise<Sandbox>;
  _experimental_createSnapshot(name: string, timeout?: number): Promise<void>;
}
```

### `PortPreviewUrl` — `@daytona/api-client`

```typescript
interface PortPreviewUrl {
  sandboxId: string;
  url: string;
  token: string;
}
```

### `SignedPortPreviewUrl` — `@daytona/api-client`

```typescript
interface SignedPortPreviewUrl {
  sandboxId: string;
  port: number;
  token: string;
  url: string;   // token embedded in URL path
}
```

### `SandboxState` — `@daytona/api-client`

```typescript
const SandboxState: {
  readonly CREATING: "creating";
  readonly RESTORING: "restoring";
  readonly DESTROYED: "destroyed";
  readonly DESTROYING: "destroying";
  readonly STARTED: "started";        // ← "running" in spec; correct value is "started"
  readonly STOPPED: "stopped";
  readonly STARTING: "starting";
  readonly STOPPING: "stopping";
  readonly ERROR: "error";
  readonly BUILD_FAILED: "build_failed";
  readonly PENDING_BUILD: "pending_build";
  readonly BUILDING_SNAPSHOT: "building_snapshot";
  readonly UNKNOWN: "unknown";
  readonly PULLING_SNAPSHOT: "pulling_snapshot";
  readonly ARCHIVED: "archived";
  readonly ARCHIVING: "archiving";
  readonly RESIZING: "resizing";
  readonly SNAPSHOTTING: "snapshotting";
  readonly FORKING: "forking";
};
```

### `Process` class — `node_modules/@daytona/sdk/src/Process.d.ts`

```typescript
export declare class Process {
  executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number
  ): Promise<ExecuteResponse>;

  codeRun(code: string, params?: CodeRunParams, timeout?: number): Promise<ExecuteResponse>;

  createSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<Session>;
  getEntrypointSession(): Promise<Session>;
  getSessionCommand(sessionId: string, commandId: string): Promise<Command>;
  executeSessionCommand(sessionId: string, req: SessionExecuteRequest, timeout?: number): Promise<SessionExecuteResponse>;
  getSessionCommandLogs(sessionId: string, commandId: string): Promise<SessionCommandLogsResponse>;
  getEntrypointLogs(): Promise<SessionCommandLogsResponse>;
  sendSessionCommandInput(sessionId: string, commandId: string, data: string): Promise<void>;
  listSessions(): Promise<Session[]>;
  deleteSession(sessionId: string): Promise<void>;

  createPty(options?: PtyCreateOptions & PtyConnectOptions): Promise<PtyHandle>;
  connectPty(sessionId: string, options?: PtyConnectOptions): Promise<PtyHandle>;
  listPtySessions(): Promise<PtySessionInfo[]>;
  getPtySessionInfo(sessionId: string): Promise<PtySessionInfo>;
  killPtySession(sessionId: string): Promise<void>;
  resizePtySession(sessionId: string, cols: number, rows: number): Promise<PtySessionInfo>;
}
```

---

## Summary of Spec Assumptions vs. Reality

| Spec Assumption | Reality |
|---|---|
| `daytona.create({command})` for inline startup | **NOT SUPPORTED** — no `command`/`entrypoint`/`startupScript` param |
| `daytona.create({public: true})` | **SUPPORTED** — `public?: boolean` in `CreateSandboxBaseParams` |
| `getPreviewLink()` returns `{url, token}` | **CORRECT** — `PortPreviewUrl = { sandboxId, url, token }` |
| `sandbox.waitUntilStarted()` exists | **CORRECT** |
| Poll `sandbox.status` | Property is `sandbox.state`, type `SandboxState`; call `refreshData()` to update |
| `sandbox.delete()` (not `destroy()`) | **CORRECT** — `delete()` is the right method name |
| `sandbox.process.executeCommand(cmd)` | **CORRECT** — signature: `(command, cwd?, env?, timeout?)` |
| RUNNING state string | **"started"** not "running" — `SandboxState.STARTED === "started"` |
| iframe without token header | **Only via `getSignedPreviewUrl()`** or `public: true` sandbox |
