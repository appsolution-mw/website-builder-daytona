# Project Environment Management Design

Task ID: T-20260503-007  
Date: 2026-05-03  
Status: Approved design, pending written-spec review

## 1. Goal

Add durable project-level environment variable management. Users can paste a
complete dotenv file into one text field, save it, and have that content become
the project's `/workspace/project/.env` inside the sandbox.

The saved content must persist outside the sandbox lifecycle. New or recreated
sandboxes for the same project must receive the saved `.env` automatically.

## 2. Decisions

- Store the environment content per project in the host database.
- Preserve the dotenv text exactly enough for comments, ordering, blank lines,
  quotes, and multiline-compatible formatting to survive round trips.
- Do not split the first version into key/value rows.
- Do not validate secrets by value or log saved contents.
- Write the saved content into the currently running sandbox immediately when
  the workspace WebSocket is connected.
- Write the saved content into new sandboxes during spawn/boot.
- Use `/workspace/project/.env` as the target file.
- Keep `/workspace/project/.env` visible and editable as a regular project file
  after it exists.

## 3. Current Project Context

The app is a Next.js 16 App Router project with a host dashboard/workspace,
Prisma, a shared WebSocket protocol, a sandbox broker, a Daytona Cloud runtime
path, and a Docker worker-pool runtime path.

Relevant existing behavior:

- `ProjectWorkspace` already sends `file.read`, `file.write`, and `file.list`
  messages through the browser-to-broker WebSocket.
- The broker's `handleFileWrite` can write safe relative files under the
  project root and rejects writes while an agent turn is active.
- Worker-pool sandbox creation passes a small env map through the worker-agent
  into the Docker container.
- `container/sandbox/entrypoint.sh` seeds `/workspace/project` before starting
  Next.js and the broker.
- Daytona Cloud boot runs a shell command after `daytona.create()` and starts
  the sandbox entrypoint from the checked-out builder repo.
- Project records are scoped by `ownerId`, currently using the local
  `DEV_USER_ID` fallback.

## 4. Product Flow

The workspace adds an `Env` control near the code/preview toolbar actions.
Opening it shows a focused editor surface with:

- A large textarea containing the saved dotenv content.
- A save action.
- A concise status line for saved, saving, sync error, or validation error.

Users paste content such as:

```dotenv
NEXT_PUBLIC_SITE_URL=https://example.com
OPENAI_API_KEY=sk-...
# Comments stay intact
```

When the user saves:

1. The browser calls a project-scoped API route with the full text.
2. The host stores the text durably in Prisma.
3. If the workspace WebSocket is open, the browser writes the same text to
   `.env` through the existing `file.write` protocol.
4. The file tree refreshes or updates so `.env` is available in the editor.

If the database save succeeds but the sandbox write fails, the UI reports that
the durable save completed but the running sandbox could not be synced. A later
manual save or sandbox restart will bring the file back.

## 5. Data Model

Add one project-scoped Prisma model:

```prisma
model ProjectEnvironment {
  projectId String   @id
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  content   String   @db.Text
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
}
```

`Project` receives an optional relation field. The first version stores one
dotenv document per project. This keeps copy/paste simple and avoids premature
secret-management UI complexity.

## 6. API

Add a project-scoped route at `app/api/projects/[id]/environment/route.ts`.

`GET` returns:

```json
{ "content": "...", "updatedAt": "..." }
```

If no environment is saved, it returns empty content and `updatedAt: null`.

`PUT` accepts:

```json
{ "content": "KEY=value\n" }
```

The route:

- Verifies the project belongs to the current user fallback.
- Rejects non-string content.
- Enforces a conservative max size, initially 64 KiB.
- Upserts the `ProjectEnvironment` row.
- Does not log content or include content in error messages.

The route stores raw text. It does not require every line to parse as dotenv,
because comments, blank lines, quotes, and future dotenv extensions should not
be damaged by the host.

## 7. Runtime And Sandbox Sync

Extend `SpawnArgs` with optional `projectEnvContent?: string`.

Project creation and fake sandbox respawn load the saved environment content
from Prisma and pass it to the runtime when spawning a sandbox. New projects
will usually have empty content; imported or restarted projects may have saved
content.

Worker-pool runtime:

- Pass the dotenv text into the container as `PROJECT_ENV_B64` when present.
- `entrypoint.sh` decodes `PROJECT_ENV_B64` after seeding
  `/workspace/project` and writes `/workspace/project/.env`.
- The script must not echo the decoded content.

Daytona Cloud runtime:

- Include the dotenv content in the boot command in a shell-safe encoded form.
- Decode and write `/workspace/project/.env` after the project directory exists
  and before the sandbox entrypoint starts Next.js.
- Avoid printing content into logs.

Fake runtime:

- After copying the project template, write `.env` into the temporary project
  root when content is present.

## 8. Workspace UI

Keep the UI dense and operational. The feature belongs in the existing
workspace, not on a separate marketing-style page.

The `Env` surface can be a lightweight panel rendered over or beside the right
pane. It should:

- Load saved content on first open.
- Allow editing in a textarea.
- Disable save while an agent turn is in flight if sandbox sync would be
  attempted through the file write lock.
- Save to the API first.
- Attempt sandbox sync only after the durable save succeeds.
- Keep unsaved text in local component state while open.
- Show a clear error if the sandbox is disconnected.

The `.env` file is intentionally not hidden from the file tree. Users who prefer
the code editor can still open and edit the generated file. The dedicated Env
surface remains the durable source; if users edit `.env` directly, those edits
are sandbox-local until they save through the Env surface.

## 9. Error Handling And Security

- Never log dotenv content.
- Never include dotenv content in thrown error messages or API responses other
  than the intentional authenticated `GET`.
- Limit content size to reduce accidental large secret dumps.
- Keep ownership checks identical to other project-scoped routes.
- If DB persistence fails, do not write the sandbox file.
- If sandbox sync fails after DB persistence, keep the durable value and report
  the sync failure.
- Do not attempt to mask values in the textarea in the first version; masking a
  pasted dotenv file is error-prone and can create false confidence.

## 10. Testing

Use test-first implementation for behavior changes.

Focused coverage:

- API route returns empty content when no env row exists.
- API route upserts and returns saved content for the owning project.
- API route rejects oversized or invalid payloads.
- Worker-pool runtime includes encoded project env when passed in `SpawnArgs`.
- Fake runtime writes `.env` into the project root when content is present.
- `entrypoint.sh` decodes `PROJECT_ENV_B64` without printing secrets.
- Workspace save flow calls the API and then writes `.env` through the broker
  when connected.

Verification commands should include the narrow tests first, then `pnpm lint`.
For runtime or TypeScript surface changes, run `pnpm build` unless blocked by
environment configuration.

## 11. Non-Goals

- Full secret vault functionality.
- Per-variable CRUD UI.
- Secret masking, rotation, or audit logs.
- Environment-specific variants such as development/staging/production.
- Syncing direct file-editor changes back into the durable DB row.
- Changing agent runtime credential passthrough.
