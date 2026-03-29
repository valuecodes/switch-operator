# AGENTS.md

## Purpose

This document is the repo-level quick-start for coding agents.
Use it for project orientation, quality gates, and safe editing workflow.

## Canonical File

- `AGENTS.md` is the source of truth.
- `CLAUDE.md` must be a symbolic link to `AGENTS.md`.
- Never edit `CLAUDE.md` directly. Always update `AGENTS.md`.

## Project Snapshot

- Project: switch-operator
- Workspace: pnpm workspaces (`tooling/`)
- Shared tooling configs: `tooling/eslint`, `tooling/prettier`, `tooling/typescript`
- Package manager: `pnpm` (lockfile: `pnpm-lock.yaml`)
- Required Node version: `24.12.0` (from `.nvmrc`)
- No app workspaces yet — `build`, `typecheck`, `lint`, and `test` are no-ops until one is added

## Commands

Run from project root.

- Install dependencies: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Format all files: `pnpm format`
- Format check: `pnpm format:check`

## Quality Gates

CI enforces the following on PRs and `main`:

- `typecheck`
- `lint`
- `format:check`
- `test`

## Repo Standards

- TypeScript strict mode
- ESLint (type-aware)
- Prettier
- Prefer minimal, targeted edits and preserve existing architecture patterns

## Safe Agent Workflow

1. Read `AGENTS.md` before starting work.
2. Make minimal, targeted edits.
3. Run checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
4. Update docs if architecture or behavior changed.
