# @repo/alerts

A non-public, cron-scheduled Cloudflare Worker that runs recurring "alert" tasks
and pushes messages to the user over Telegram (reusing the operator's bot).

Stage 1 ships a single **healthcheck** alert. The worker is built around an
**array of alerts**, each declaring its own cron cadence.

## How it works

- `src/alerts/` holds the alerts. Each implements the `Alert` contract
  (`src/alerts/types.ts`): a `name`, a `cron` string, and an async `run(ctx)`
  that returns the message to send — or `null` to send nothing this run.
- `src/alerts/index.ts` exports the `alerts` array (the registry).
- `src/scheduled.ts` is the cron handler. On each fire it runs only the alerts
  whose `cron` matches `event.cron`, then sends any returned messages to
  `ALLOWED_CHAT_ID` via `@repo/telegram`. A failing alert is logged and does not
  block the others.
- The worker has no public `fetch` handler and sets `"workers_dev": false`.

## Adding an alert

1. Create `src/alerts/<name>.ts` implementing `Alert`.
2. Add it to the `alerts` array in `src/alerts/index.ts`.
3. **Add its `cron` to `wrangler.jsonc` `triggers.crons`** (the union of all
   alert crons). This is the one manual invariant — an alert whose cron is not
   registered will never fire.

## Local development

```sh
# from repo root
pnpm --filter @repo/alerts dev        # runs `wrangler dev --test-scheduled`
```

`wrangler dev --test-scheduled` exposes a `/__scheduled` endpoint. Trigger a
specific cron manually:

```sh
curl "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
```

Local secrets live in `apps/alerts/.dev.vars` (gitignored):

```
TELEGRAM_BOT_TOKEN=...
ALLOWED_CHAT_ID=...
```

## Secrets & deploy

Production secrets are **not** in `wrangler.jsonc`. Set them once per Cloudflare
environment:

```sh
pnpm --filter @repo/alerts exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm --filter @repo/alerts exec wrangler secret put ALLOWED_CHAT_ID
```

Deploys run automatically on push to `main` (see `.github/workflows/main.yml`).
