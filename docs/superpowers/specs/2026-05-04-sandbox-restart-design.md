# Sandbox Restart Design

Task: T-20260504-012

## Goal

Workspace users can restart a project's sandbox from the editor UI. Restart means
hard recreation: destroy the current sandbox, spawn a fresh sandbox for the same
project source, keep the stored project environment, and update the project with
the new broker and preview URLs.

## Behavior

- Add a project-scoped restart HTTP boundary under the existing project API.
- Require the current user to own the project.
- Reject restart while the project is already provisioning.
- Destroy the existing sandbox when `daytonaSandboxId` exists. Fake sandboxes use
  the fake Daytona runtime, matching the existing delete behavior.
- Spawn a new sandbox from the persisted project source:
  - Template projects use `{ type: "template" }`.
  - GitHub projects use the stored installation, owner, repo, and branch, with a
    fresh installation access token.
- Pass saved `ProjectEnvironment.content` to the spawn request.
- On success, set the project to `RUNNING`, replace sandbox URLs/tokens, and
  clear any old provisioning error.
- On failure, store a sanitized provisioning error and avoid exposing secrets.

## UI

Add a small restart action to the workspace header. While restart is in flight,
disable the button, show a spinner, and keep the current screen stable until the
API returns. After success, replace the local `project` payload, reset websocket
readiness, and force the preview iframe to remount.

## Testing

Use TDD for the host route. Cover that restart destroys the old sandbox, respawns
with saved env content and the stored source, and returns the updated project.
Run the focused route test before and after implementation.
