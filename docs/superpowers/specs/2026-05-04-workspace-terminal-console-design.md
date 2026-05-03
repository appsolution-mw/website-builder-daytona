# Workspace Terminal And Console Design

Task: `T-20260504-013`

## Goal

Add two workspace diagnostics surfaces:

- `Terminal`: run explicit shell commands in the active sandbox project root and show stdout/stderr plus exit status.
- `Console`: show browser console output and runtime errors produced by the current Preview iframe.

## Scope

This is an MVP for command execution and preview diagnostics. It does not add a full PTY, interactive stdin, terminal emulation, persisted command history, or sandbox process management outside the command that the user starts from the UI.

## Architecture

The existing browser-to-broker WebSocket remains the transport boundary. `@wbd/protocol` gains terminal message types. The sandbox broker spawns commands in `projectRoot` with the platform shell, streams stdout/stderr back to the browser, and supports aborting the active command. The host workspace renders output in a new `Terminal` tab.

Preview console output is captured in the host UI without broker involvement. The iframe receives a small `srcDoc` bridge that wraps the real preview URL, injects console/error listeners into the same-origin frame, and relays events to the parent with `postMessage`. The workspace listens for those events and renders them in a new `Console` tab.

## UI

`RightPane` receives four tabs: `Code`, `Preview`, `Terminal`, and `Console`. Terminal and Console use dense operational panels matching the existing workspace style: compact toolbar, monospace output, clear status chips, and accessible controls.

## Safety And Constraints

Terminal commands run only under `projectRoot`. The broker rejects terminal runs while an agent turn is active, matching the editor write lock and avoiding concurrent mutations. Output is bounded in the UI to prevent memory growth.

## Verification

- Broker tests cover terminal command output and terminal rejection while an agent turn is active.
- Host lint/type checks cover the protocol and workspace UI.
