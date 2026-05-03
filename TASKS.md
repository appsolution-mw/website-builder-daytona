# Tasks

This file tracks project work with stable task IDs. Use one entry per logical
task and reference the ID in commits and changelog entries.

## T-20260503-001 — Add Project Task And Changelog Workflow

- Date: 2026-05-03
- Status: Done
- Scope: Update `AGENTS.md` with project-specific workflow rules and introduce
  `TASKS.md` plus `CHANGELOG.md` as the canonical lightweight project journal.
- Plan:
  - Keep the existing Next.js 16 warning intact.
  - Adapt only rules that fit this project.
  - Exclude Polytan-specific Sass, next-intl, tone, and website-content rules.
  - Document this task in `CHANGELOG.md` after completion.
- Result:
  - Added the project task journal and changelog.
  - Updated `AGENTS.md` with project-specific workflow, verification, Git, and
    Next.js/runtime rules.

## T-20260503-002 — Add Project Codex Commit Agent Config

- Date: 2026-05-03
- Status: Done
- Scope: Review and commit the untracked `.codex/` project configuration.
- Plan:
  - Inspect `.codex/` for secrets and unrelated content.
  - Adapt any copied project names or instructions to `website-builder-daytona`.
  - Commit the `.codex/` config with matching `TASKS.md` and `CHANGELOG.md`
    entries.
- Result:
  - Added project-local Codex custom-agent configuration for focused commit
    creation.
  - Replaced copied Polytan wording with `website-builder-daytona` wording.
