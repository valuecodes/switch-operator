---
description: Triage PR review comments, fix the valid ones, then reply to each comment (manual commit + push)
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh pr comment:*), Bash(gh api:*), Bash(gh repo view:*), Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git branch:*), Bash(pnpm:*)
argument-hint: [PR-number]
---

Triage PR review comments, fix the valid ones, then reply to each comment. The command will NOT commit or push — that's a manual step. Three confirmation gates: never proceed past one without my explicit "yes".

Arguments: `$ARGUMENTS` — optional PR number. If omitted, use the PR for the current branch.

## 1. Resolve PR (read-only)

If `$ARGUMENTS` is a number, use that PR. Otherwise `gh pr view --json number,headRefName,state,title,url,baseRefName`. Stop if no PR exists for the current branch.

Capture `<owner>` and `<repo>` from `gh repo view --json owner,name`.

## 2. Fetch comments (read-only)

Pull all three sources, retaining each comment's `id` (needed to reply):

- General PR comments: `gh api repos/<owner>/<repo>/issues/<PR>/comments`
- Review / line comments: `gh api repos/<owner>/<repo>/pulls/<PR>/comments`
- Review summaries / approvals: `gh api repos/<owner>/<repo>/pulls/<PR>/reviews`

Skip any comment authored by the current `gh api user --jq .login` (don't re-engage your own past replies).

## 3. Triage

Classify each comment:

- **valid** — concrete claim or actionable suggestion grounded in the diff. Will be fixed.
- **question** — clarifying question; no code change, but reply needed.
- **noise** — bot welcome / "review enabled" / auto-generated PR overview / "show summary per file". No fix, no reply by default.
- **approved** — APPROVED review with no concrete request. Acknowledge with `👍 thanks`, no fix.

Show one table:

```
ID           AUTHOR                FILE:LINE                  CLASS     ONE-LINE SUMMARY
<id>         <user>                <path:line | -->           <class>   <≤ 90 chars>
```

Then propose a fix plan for everything classified `valid`:

```
[id <id>]  <file>(:line)
  → <one-line description of the change>
```

Group related fixes (same file or shared root cause) into a single edit when natural.

**GATE 1.** Ask exactly: `Triage + fix plan look right? (yes / edit / cancel)`. Wait.

If `edit`: let me reclassify (e.g. "id 1234 is noise") or adjust the plan, then re-confirm.

## 4. Apply fixes (only after Gate 1 = yes)

1. If `git status --porcelain` is non-empty, STOP — don't mix the user's WIP into the fix commit. Tell me to stash/commit first.
2. Make minimal edits per the confirmed plan. Don't fix things that weren't reported.
3. Run validation, only scripts that exist in `package.json`:
   ```
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm format
   ```
   If any fail, STOP and show the failure. Do not commit broken code, do not post replies promising a non-existent fix.
4. Show me the diff (`git diff`) for review.

**GATE 2.** Ask: `Fixes look right? (yes / edit / cancel)`. Wait.

On `yes`, do NOT commit and do NOT push. Instead:

5. Print a suggested commit message I can copy-paste:

   ```
   fix: address PR review feedback

   addresses: <comment-id>, <comment-id>
   ```

6. STOP. Wait for me to commit + push manually. When I reply with `pushed` (or equivalent), continue to section 5 below — not before.
7. Once I confirm, run `git rev-parse HEAD` to capture the new commit SHA. It goes in the reply text.

## 5. Draft replies (only after Gate 2 = yes)

For each comment classified `valid`, `question`, or `approved`, write a reply.

Style: terse, one or two sentences max. Per-class template:

- `valid` → `Fixed in <sha>: <one-line of what changed>.` Optionally a brief follow-up if the fix isn't 1:1 to the suggestion.
- `question` → answer directly. Don't speculate. If the answer is "this is intentional because X", say that.
- `approved` → `👍 thanks`.
- `noise` → no reply.

Show all drafts in one block, grouped by comment id.

**GATE 3.** Ask: `Post these replies? (yes / edit / cancel)`. Wait.

## 6. Post replies (only after Gate 3 = yes)

- **Review / line comment** (came from `pulls/<PR>/comments`): reply in-thread:
  `gh api --method POST repos/<owner>/<repo>/pulls/<PR>/comments/<id>/replies -f body="<reply>"`
- **General PR comment** (came from `issues/<PR>/comments`): `gh pr comment <PR> --body "<reply>"`, quoting the original with `> @<user>` for context.
- **Review summary** (came from `pulls/<PR>/reviews`): no per-thread reply API. If a reply is genuinely warranted (rare), post a general comment @-mentioning the reviewer; otherwise skip.

After each post, confirm it returned a 200/201. If any fail, list exactly which — don't claim success for a failed post.

## 7. Final summary

Print:

- `Triaged: <N>  Fixed: <N>  Replied: <N>  Skipped (noise): <N>`
- Commit SHA(s)
- PR URL

Stop.

## Hard rules

- Never edit code before Gate 1 confirms.
- Never run `git commit` or `git push`. Those are manual — print the suggested commit message, then wait for me to confirm `pushed`.
- Never post replies before Gate 3 confirms.
- Never promise a fix that didn't actually land. Validation must pass AND I must confirm `pushed` before drafting replies.
- Never address a comment that wasn't in the confirmed set (no scope creep).
- Never reply to your own past comments.
