---
description: Open a GitHub PR for the current branch with an auto-generated title and body
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git branch:*), Bash(git push:*), Bash(gh auth status:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh repo view:*)
argument-hint: [--draft]
---

Open a GitHub PR for the current branch. Generate the title + body, show them to me, confirm, then push + create.

Arguments: `$ARGUMENTS` — if it contains `--draft`, create the PR as draft.

## Pre-flight

Stop with a clear message if any of these fail:

1. `gh auth status` — gh must be authenticated.
2. `git rev-parse --abbrev-ref HEAD` — must not be on `main`/`master`.
3. Determine base branch: try `main`, fall back to `master`. If neither exists, stop.
4. `git log <base>..HEAD --oneline` — if empty, stop ("nothing to PR").
5. `gh pr view --json url,state` on the current branch — if a PR already exists, print its URL and stop. Do NOT create a duplicate.
6. `git status --porcelain` — if there are uncommitted changes, warn me but do NOT commit them.

## Generate

Run `git diff <base>...HEAD` and `git log <base>..HEAD --oneline`, then produce:

- **Title**: plain English sentence (NOT `<type>: <subject>` semantic format). Capitalized, present tense, ≤ 72 chars, no trailing period.
- **Body**: three sections, total ~15–25 lines, skim-friendly.
  - `### What`: 2–4 short bullets. Lead with the _why_ (bug, gap, user need), then key changes. No opening paragraph. Skip anything obvious from the diff.
  - `### How to test`: commands one per line, no prose, no "expected results". Use only scripts that exist in `package.json` (verify first). Prefix manual steps with `Recommended:` if you didn't run them.
  - `### Security review`: default to single line `No security-impacting changes.` Expand to checklist only when an item is actually affected. Format when expanded:
    - **Secrets / env vars:** <what changed>
    - **Auth / session:** <what changed>
    - **Network / API calls:** <what changed>
    - **Data handling / PII:** <what changed>
    - **Dependencies:** <what changed>

    Omit lines that didn't change.

## Confirm

Show me the title and body in two separate fenced code blocks. Then ASK explicitly: `Open this PR? (yes / edit / cancel)`. Wait for my reply. Do NOT push or create the PR without my confirmation.

If I say "edit", let me edit, then re-confirm.

## Create

On confirmation:

1. Push the branch with `git push -u origin <current-branch>` (skip if `git status -sb` shows the branch is already published and up to date).
2. Run `gh pr create --base <base> --title "<title>" --body "$(cat <<'EOF' ... EOF)"` — pass the body via heredoc so newlines survive. Add `--draft` if requested.
3. Print the PR URL that `gh` returns.

Do not commit on my behalf. Do not push without confirmation. Do not skip the confirmation step.
