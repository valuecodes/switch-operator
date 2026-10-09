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

| Name          | Filter                | Description                                  |
| ------------- | --------------------- | -------------------------------------------- |
| alpha-vantage | `@repo/alpha-vantage` | Alpha Vantage market data client             |
| http-client   | `@repo/http-client`   | Fetch wrapper with Zod response validation   |
| logger        | `@repo/logger`        | Structured JSON logger                       |
| telegram      | `@repo/telegram`      | Telegram Bot API client                      |
| url-validator | `@repo/url-validator` | Safety policy checks for user-supplied URLs  |

### Tooling (`tooling/`)

| Name       | Filter             | Description                                                      |
| ---------- | ------------------ | ---------------------------------------------------------------- |
| prettier   | `@repo/prettier`   | Shared Prettier config                                           |
| typescript | `@repo/typescript` | Shared tsconfig presets (`base.json`, `node.json`, `react.json`) |
| github     | `@repo/github`     | GitHub Actions composite setup action, gitleaks `secrets-scan`   |

Apps may import packages; packages must never import apps. oxlint bans `../`
imports and deep `@repo/*/src` imports: import other workspaces by package name,
and inside an app use the `~/` alias (`src/*`) to go up the tree.

---

## Commands

**Prerequisites:** Node.js 24.21.0 (`.nvmrc`), pnpm 12.6.0 (`packageManager` in root `package.json`).

```bash
pnpm install                     # Install all dependencies
pnpm dev                         # turbo run dev (all workers)

pnpm lint                        # oxlint, one process over the whole repo
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # prettier --write .
pnpm format:check                # prettier --check . (no writes)
pnpm secrets:scan                # gitleaks over the full git history
pnpm clean                       # turbo run clean

pnpm --filter @repo/operator set-webhook <url> [-- --prod]
```

`lint` and `knip` do not go through Turbo — each is a single process over the whole
repo. oxlint is configured by the root `.oxlintrc.json` (including `import/no-cycle`)
and prints nothing when there are no findings, so silent output means clean. Knip is
configured by the root `knip.jsonc` and exits 0 when clean.

There is no post-edit formatting hook: run `pnpm format` yourself before committing.

`secrets:scan` runs gitleaks (`tooling/github/scripts/secrets-scan.sh`, version pinned
there) using a local `gitleaks` v8.19+ if one is on PATH, otherwise the pinned Docker image.
It exits 0 when clean and 1 when it finds a leak.

CI (`.github/workflows/`) runs typecheck, lint, knip, format-check, test, secrets-scan
and CodeQL code scanning (`javascript-typescript` and `actions`) on push to `main` and
on PRs. On `main`, the workers deploy to Cloudflare once those checks pass, and D1
migrations apply when `apps/operator/migrations/**` changes.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, `.env`, `.dev.vars` or `.prod.vars` files.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Versions shared by more than one package go in the `catalog:` block of
  `pnpm-workspace.yaml`; single-consumer deps are pinned inline.
- Every install enforces the supply-chain settings in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`) plus pnpm 12's default
  `blockExoticSubdeps`. When one fails, investigate: never disable it, and never
  exclude a whole package to get past it.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm format:check` and `pnpm test`
  before committing. Update docs when architecture or behavior changes.
