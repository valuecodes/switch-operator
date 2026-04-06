# Switch Operator — Current Plan

## Overview

Personal AI assistant that communicates via Telegram, runs on Cloudflare
Workers, and currently supports AI replies, scheduled reminders, and web
monitoring.

## Current Architecture

```
You (Telegram on phone)
    | Telegram Bot API
    | Webhook
Cloudflare Worker (fetch handler + scheduled handler)
    |-- OpenAI API (chat replies + monitor analysis)
    |-- D1 (schedules, pending confirmations)
    |-- Cron Trigger (minute-based schedule runner)
    |-- External websites (monitor scraping)
```

**Chat flow:** Telegram message -> Bot API webhook -> CF Worker -> OpenAI API
-> reply via Bot API -> Telegram message back to you.

**Schedule flow:** Telegram message -> OpenAI tool call -> pending confirmation
stored in D1 -> user replies `YES` -> schedule stored in D1 -> cron trigger
executes due reminders or monitors.

## Monorepo Structure

```
apps/
  operator/            # Single CF Worker: webhook + scheduled handlers
    src/
      index.ts         # Entry: Hono app with health + Telegram routes
      scheduled.ts     # Cron-driven reminder/monitor executor
      db/              # Drizzle schema for D1 tables
      middleware/      # Env validation, error handling, request logging
      modules/
        health/
        telegram/
      services/        # OpenAI, Telegram, schedule, scrape, pending-action
      types/
    migrations/        # Wrangler/Drizzle SQL migrations for D1
    wrangler.jsonc
    package.json
packages/
  http-client/         # Shared fetch wrapper with response validation
  logger/              # Shared structured logger used by apps
tooling/
  eslint/              # Shared ESLint config
  prettier/            # Shared Prettier config
  typescript/          # Shared TypeScript config
```

## Key Decisions

| Area              | Choice                 | Why                                                           |
| ----------------- | ---------------------- | ------------------------------------------------------------- |
| Framework         | Hono                   | Lightweight, built for CF Workers, good middleware support    |
| Messaging         | Telegram Bot API       | Free, native webhooks, no self-hosted bridge needed           |
| LLM               | OpenAI API             | Generates replies and analyzes monitored page content         |
| Storage           | D1 (SQLite)            | Stores schedules and pending confirmation actions             |
| Scraping          | `fetch` + HTML parsing | Works inside Workers without adding a browser dependency      |
| Schedule executor | Cron trigger           | Runs due reminders and monitors every minute                  |
| Safety            | Pending confirmation   | Requires explicit `YES` before creating or deleting schedules |

## Security

- All secrets in CF Worker secrets (never in repo)
- `.dev.vars` in `.gitignore` for local dev
- Webhook auth via Telegram secret token header (`X-Telegram-Bot-Api-Secret-Token`)
- Telegram source IP allowlist enforced via Cloudflare `CF-Connecting-IP`
- Chat ID allowlist (your Telegram user ID only)
- Pending schedule mutations expire automatically after two minutes
- Public repo is fine; no secrets in code

## Implemented

- Worker entrypoint with health and Telegram webhook routes
- Telegram IP allowlisting, secret verification, body limit, and schema validation
- OpenAI-backed chat replies for the allowed Telegram chat
- Tool-backed schedule listing, creation, and deletion
- D1-backed persistence for schedules and pending confirmations
- Minute-based cron execution for reminders and web monitors
- URL scraping plus OpenAI analysis for monitor schedules
- Retry and dead-letter handling for failed scheduled jobs
- Local and remote migration scripts for the D1 schema

## Backlog

- Conversation history and richer context persistence
- Rate limiting and abuse controls beyond the current single-chat allowlist
- Monitoring/observability improvements beyond basic Worker logs
- More operator-facing diagnostics for failed or dead-lettered schedules
- Additional assistant tools as needed
