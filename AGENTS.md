# AGENTS.md

Guidelines for AI agents and contributors working in this Turborepo monorepo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

### Apps (`apps/`)

| Name            | Filter                  | Description                                    |
| --------------- | ----------------------- | ---------------------------------------------- |
| operator        | `@repo/operator`        | Telegram operator Cloudflare Worker (Hono, D1) |
| browser-scraper | `@repo/browser-scraper` | Headless-browser scraping Cloudflare Worker    |
| alerts          | `@repo/alerts`          | Scheduled market alerts Cloudflare Worker      |

### Packages (`packages/`)

| Name          | Filter                | Description                                       |
| ------------- | --------------------- | ------------------------------------------------- |
| alpha-vantage | `@repo/alpha-vantage` | Alpha Vantage market data client                  |
| http-client   | `@repo/http-client`   | Fetch wrapper with Zod response validation        |
| logger        | `@repo/logger`        | Structured JSON logger                            |
| telegram      | `@repo/telegram`      | Telegram Bot API client                           |
| typescript    | `@repo/typescript`    | Shared tsconfig presets (`base`, `node`, `react`) |
| url-validator | `@repo/url-validator` | Safety policy checks for user-supplied URLs       |

CI helpers are not workspaces: the composite setup action lives in
`.github/actions/setup/`.

Apps may import packages; packages must never import apps. oxlint bans `../`
imports and deep `@repo/*/src` imports: import other workspaces by package name,
and inside an app use the `~/` alias (`src/*`) to go up the tree.

---

## Commands

**Prerequisites:** Node.js 26 (exact version in `.nvmrc`), pnpm 12 (exact version in `packageManager` in root `package.json`).

```bash
pnpm install                     # Install all dependencies
pnpm dev                         # turbo run dev (all workers)

pnpm lint                        # oxlint, one process over the whole repo
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # oxfmt, writes in place
pnpm format:check                # oxfmt --check (no writes)
pnpm clean                       # turbo run clean

pnpm --filter @repo/operator set-webhook <url> [-- --prod]
```

`lint` and `knip` do not go through Turbo — each is a single process over the whole
repo. oxlint is configured by the root `.oxlintrc.json` (including `import/no-cycle`)
and prints nothing when there are no findings, so silent output means clean. Knip is
configured by the root `knip.jsonc` and exits 0 when clean. Formatting is oxfmt
(Prettier-compatible), configured by the root `.oxfmtrc.jsonc`, which also sorts
imports.

Nothing formats on edit, and the pre-commit hook only checks formatting: run
`pnpm format` yourself before committing.

Git hooks live in `.githooks/` and are plain shell scripts, with no hook manager.
`pnpm install` enables them through the root `prepare` script. The setting goes in
the clone's shared git config, so it covers every worktree, and a branch without
`.githooks/` simply runs no hooks. If you cloned before the hooks existed and have
not run `pnpm install` since, run `git config core.hooksPath .githooks` once.
`pre-commit` runs `format:check`, `lint` and `gitleaks git --staged` with the local
gitleaks (v8.19+). The secrets scan fails closed, so the commit is refused when
gitleaks is not installed. `pre-push` runs `typecheck`, `test` and `knip`. CI still
runs every check. `format:check` and `lint` read the working tree, not the staged
snapshot, so stage everything you mean to commit.

The hook runs whatever gitleaks is installed; CI scans the full git history with the
version pinned in `secret-scan.yml` from `valuecodes/maintain-kit`, so this repo holds
no gitleaks pin.

CI checks are defined once, in the reusable `.github/workflows/checks.yml`: typecheck,
lint, knip, format:check, test, CodeQL code scanning (`javascript-typescript`),
secret-scan and workflow-lint. secret-scan and workflow-lint call the reusable workflows
from `valuecodes/maintain-kit`: gitleaks over the full git history, and actionlint (with
shellcheck) and zizmor over the workflow and action files. Each tool reads
`.github/actionlint.yaml` / `zizmor.yml` if added. The
typecheck and test jobs restore Turbo's `.turbo` cache from the previous run of the same
task, so unchanged packages replay instead of rerunning. Two workflows call it:

- `feature.yml` (PRs) runs the checks and fans them into `all-passed`, the one check to
  require in branch protection.
- `main.yml` (push to `main`) runs the checks, then the `deploy` job deploys the three
  workers to Cloudflare through the `production` environment.

D1 migrations are a separate workflow (`migrations.yml`): it runs on push to `main` when
`apps/operator/migrations/**` changes and does not wait for CI or the deploy.

Dependabot (`.github/dependabot.yml`) bumps the SHA-pinned actions and reusable workflows
monthly in one grouped PR; npm dependencies are updated by hand.

`maintain-kit-dashboard.yml` calls the dashboard workflow from
`valuecodes/maintain-kit` daily.
It keeps one issue, **Maintenance dashboard** (label `maintain-kit-dashboard`), listing
what is due: `catalog:` updates, pnpm (`packageManager`), Node.js (`.nvmrc`) and
`pnpm audit` findings. Like
`minimumReleaseAge`, a release shows up only once it is 14 days old; a Node.js security
release shows up right away and is flagged. It never opens PRs or commits. For a
Node.js bump, change only `.nvmrc` (the one place that holds the exact version).

`maintain-kit-updates.yml` calls the updates workflow from
`valuecodes/maintain-kit` weekly. It keeps one PR per kind open (Node.js, pnpm,
`catalog:`) on a `maintain-kit/<kind>` branch, for updates on the
current major only; majors stay manual. Those PRs are opened with `GITHUB_TOKEN`, so
their `pull_request` checks wait until someone with write access clicks **Approve
workflows to run** in the PR. It needs **Allow GitHub Actions to create and approve
pull requests** turned on under Settings → Actions → General. Nothing auto-merges.
The dashboard, updates, secret-scan and workflow-lint callers pin the
same `valuecodes/maintain-kit` commit, so bump them together.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, `.env`, `.dev.vars` or `.prod.vars` files.
- Never bypass the git hooks with `--no-verify`; fix the failure instead.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Every external version lives in the `catalog:` block of `pnpm-workspace.yaml`
  and manifests reference it as `catalog:`; `@repo/*` deps stay `workspace:*`.
  Update with `pnpm up --latest -r`; `updateConfig.ignoreDependencies` holds
  `@types/node` to the `.nvmrc` major, so bump it by hand.
- Every install enforces the supply-chain settings in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`, `engineStrict`) plus pnpm
  12's default `blockExoticSubdeps`. When one fails, investigate: never disable
  it, and never exclude a whole package to get past it.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm format:check` and `pnpm test`
  before committing. Update docs when architecture or behavior changes.
