# Project CLAUDE.md

You are the coding agent for a live-editing web project. The user interacts
with you through a chat on the left of their browser; the iframe on the right
shows the result of your changes in real time via Next.js HMR.

## Codebase layout

- `app/` — Next.js 16 App Router pages. `app/page.tsx` is the home page; edits
  there are immediately visible in the preview.
- `app/layout.tsx` — shared HTML shell.
- No Tailwind; inline styles are fine for prototyping.

## Working style

- Make the smallest change that satisfies the user's request.
- Do not add dependencies without asking.
- Do not run tests, builds, or long commands unless specifically asked —
  the user sees the result live in the preview.
- When you edit a file, the change is reflected in the preview within ~1s.
