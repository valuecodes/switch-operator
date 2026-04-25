---
description: Generate a PR title and description from the current branch's diff vs main (does not create a PR)
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git branch:*)
---

Generate a PR title and description from the diff for this repository. Do NOT run `gh pr create` or any other PR-creation command — only produce the text for me to copy-paste.

Steps:

1. Determine the base branch — default to `main`. If `main` does not exist, fall back to `master`. If neither exists, tell me and stop.
2. Run `git diff <base>...HEAD` and `git log <base>..HEAD --oneline` to see what would land in the PR.
3. If the diff is empty (current branch has no commits beyond the base), tell me and stop.
4. Otherwise produce the output described below.

## PR Title

A plain English sentence describing what the PR does. Rules:

- Plain sentence — do NOT use `<type>: <subject>` semantic-commit format.
- Start with a capital letter, present tense, imperative-ish (e.g. "Add argument parsing to the CLI", "Cover main output with tests", "Align ESLint config across packages").
- <= 72 chars, no trailing period.
- Mention the area touched when helpful (cli, tests, tooling, config, docs).

## PR Description (Required Sections)

Total body should fit on one screen — roughly 15–25 lines. The diff carries the detail; the description is a map, not a transcript. Don't restate what's obvious from the file list.

### What

2–4 short bullets. Lead with the _why_ (the bug, the gap, the user need) — one bullet, one sentence. Then list the key changes. No opening paragraph. No re-describing every file. Skip anything a reviewer can see from the diff in 10 seconds.

### How to test

The commands actually run, one per line. No prose, no "expected results" — `pnpm test` either passes or it doesn't. Add a manual step only when behavior is user-visible (UI, CLI output, integration with an external service). If the manual step wasn't run, prefix with "Recommended:".

Use only scripts that exist in `package.json`. Common ones: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm dev`.

### Security review

Default to a single line: `No security-impacting changes.`

Expand to the full checklist only when at least one item is actually affected (new deps, new external calls, secrets/env touched, auth/session touched, new logging of user data). Format when expanded:

- **Secrets / env vars:** <what changed>
- **Auth / session:** <what changed>
- **Network / API calls:** <what changed>
- **Data handling / PII:** <what changed>
- **Dependencies:** <what changed>

Omit lines that didn't change. Don't list "not changed" five times.

## Output format

Output two fenced code blocks back-to-back so each is independently copy-pasteable:

1. First block (label `text`): just the title, one line.
2. Second block (label `markdown`): the full description body, starting with `## What`.

No preamble, no explanation, no "here is your PR" wrapper text. Just the two blocks.

Tone: terse, high-signal, skimmable. If a sentence doesn't help the reviewer decide whether to approve, cut it.
