---
description: Codex-powered thorough review of a plan or design document — finds holes, hidden assumptions, and bugs in the plan itself
argument-hint: "[--wait|--background] [path/to/plan.md]"
allowed-tools: Read, Write, Bash(node:*), Bash(ls:*), AskUserQuestion
---

Run a thorough adversarial Codex review of a plan or design document. The plan has NOT been implemented yet — Codex's job is to stress-test the plan itself, not produce code.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is review-only.
- Do not fix issues, apply patches, or suggest you are about to make changes.
- Your only job is to run Codex and return its output verbatim.

Locating the plan:

1. If the arguments include a path that looks like a file (e.g. `docs/plan.md`, `./plan.md`, an absolute path), resolve it relative to the current working directory and use that file as the review target. Verify it exists with `Read` before invoking Codex.
2. If no path is given, take the most recent plan you (Claude) produced in this conversation, write its full markdown to `/tmp/review-plan-<unix-ts>.md` with the `Write` tool, and use that file as the review target. Do not summarize or trim — write it verbatim.
3. If you cannot locate a plan in either place, ask the user where the plan lives. Do not proceed without a target.

Execution mode rules:

- If the arguments include `--wait`, run in the foreground without asking.
- If the arguments include `--background`, run as a background Bash task without asking.
- Otherwise, recommend foreground (`--wait`) — plan reviews are usually small and fast. Use `AskUserQuestion` exactly once with two options, recommended first:
  - `Wait for results (Recommended)`
  - `Run in background`

Resolving the Codex companion:

- The codex plugin lives under `~/.claude/plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs`. Resolve the latest version dynamically:

```bash
COMPANION="$(ls -1d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)"
```

- If `$COMPANION` is empty, tell the user to run `/codex:setup` and stop.

Building the prompt:

- Use the heredoc below verbatim, substituting `<PATH>` with the absolute path to the plan file.
- Do NOT pass `--write`. This is read-only review — Codex must not modify any files.
- Do NOT pass `--resume-last`. Each plan review is a fresh Codex thread.

Foreground flow:

```bash
node "$COMPANION" task "$(cat <<'EOF'
You are reviewing a plan / design document. The plan is for a coding change that has NOT been implemented yet — your job is to stress-test the plan itself, not produce code or modify files.

Read the file at <PATH> first. Then review the plan adversarially for:

- Hidden assumptions and where they break under real conditions.
- Missing steps, gaps, or hand-waving in the design.
- Ordering / dependency issues (e.g. migration vs deploy ordering, type changes that break callers, schema changes that aren't backward-compatible).
- Race conditions and concurrency bugs implied by the proposed runtime behavior.
- Security gaps (auth, input validation, replay, token spoofing, IDOR, allowlist bypass).
- Backwards-compatibility, rollback, and data-migration risks.
- Edge cases and failure modes the plan does not address (timeouts, partial failures, retries, idempotency).
- Test coverage gaps — both what's listed and what's silently missing.
- Vague language that hides ambiguity ("handle gracefully", "as needed", "if necessary", "etc").
- Scope or effort that looks unrealistic for the risk implied.
- External-system contracts (APIs, webhooks) the plan relies on without verifying.

Rules:
- If the plan is sound, say so explicitly and stop. Do not invent issues to look thorough.
- If you find issues, list them ordered by severity (Critical / High / Medium / Low). For each issue: cite the section of the plan it relates to, describe the concrete failure mode, and give a one-line fix or open question.
- End with a short verdict: "Ship as-is", "Ship after fixing the Critical/High items", or "Re-plan".
- Do not write code. Do not modify any files. Output one review only.
EOF
)"
```

Background flow:

- Same command, launched via `Bash` with `run_in_background: true`. After launching, tell the user: "Codex plan review started in the background. Check `/codex:status` for progress."

Output rules:

- Foreground: return the stdout of `codex-companion` verbatim — no commentary before or after, no paraphrasing.
- Do not fix any issues Codex raises in the same turn. The user will follow up if they want changes.
