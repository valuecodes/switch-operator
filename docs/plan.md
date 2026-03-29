# Switch Operator — Implementation Plan

## Overview

Personal AI assistant that communicates via Telegram, runs on Cloudflare Workers, and can execute tasks like web scraping and alerting.

## Architecture

```
You (Telegram on phone)
    | Telegram Bot API
    | Webhook
Cloudflare Worker (gateway + queue consumer + cron)
    |-- Claude API (LLM brain with tool_use)
    |-- D1 (conversations, alerts, task results)
    |-- KV (scrape cache, rate limiting)
    |-- Queue (async heavy tasks)
    |-- Cron Trigger (scheduled alert checks)
```

**Core flow:** Telegram message -> Bot API webhook -> CF Worker -> Claude API (with tools) -> reply via Bot API -> Telegram message back to you.

## Monorepo Structure

```
apps/
  operator/            # Single CF Worker: fetch + queue + scheduled handlers
    src/
      index.ts         # Entry: fetch, queue, scheduled exports
      routes/telegram-webhook.ts
      services/telegram.ts, llm.ts, task-runner.ts
      tools/scrape.ts, alert.ts, remind.ts
      db/schema.sql, queries.ts
    wrangler.jsonc
    package.json
tooling/
  eslint/              # Shared ESLint config
  prettier/            # Shared Prettier config
  typescript/          # Shared TypeScript config
```

## Key Decisions

| Area       | Choice                   | Why                                                   |
| ---------- | ------------------------ | ----------------------------------------------------- |
| Framework  | Hono                     | Lightweight, built for CF Workers, middleware support |
| Messaging  | Telegram Bot API         | Free, native webhooks, no self-hosted bridge needed   |
| LLM        | Claude API with tool_use | Native tool dispatch, no custom framework needed      |
| Storage    | D1 (SQLite)              | Zero-config, free tier is more than enough            |
| Cache      | KV                       | Fast reads with TTL                                   |
| Async work | CF Queues                | Native, no external queue service                     |
| Scraping   | fetch + HTMLRewriter     | Native to CF Workers                                  |

## Security

- All secrets in CF Worker secrets (never in repo)
- `.dev.vars` in `.gitignore` for local dev
- Webhook auth via Telegram secret token header (`X-Telegram-Bot-Api-Secret-Token`)
- Chat ID allowlist (your Telegram user ID only)
- Public repo is fine -- no secrets in code

## Implementation Phases

### Phase 1: Scaffold CF Worker [DONE]

- Set up `apps/operator` with Hono, wrangler, tsconfig, eslint
- `GET /health` endpoint
- CI deploy to Cloudflare on merge to main
- All quality gates passing (typecheck, lint, format, test)

### Phase 2: Telegram Integration

- Create bot via @BotFather, get bot token
- `POST /webhook/telegram` route to receive messages
- Telegram Bot API client service (`services/telegram.ts`)
  - `sendMessage` via `POST /bot<token>/sendMessage`
  - Webhook validation via `X-Telegram-Bot-Api-Secret-Token` header
- Chat ID allowlist -- reject messages from non-allowed users
- Register webhook URL with Telegram (`setWebhook` API call)
- Echo bot: receive message, send it back
- Store `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_CHAT_ID` as CF Worker secrets

### Phase 3: AI Brain

- Add `@anthropic-ai/sdk` dependency
- Implement LLM service (`services/llm.ts`)
  - Send user message + conversation history to Claude API
  - Define tool schemas for Claude's tool_use
  - Handle tool_use responses (execute tool, return result)
- Set up D1 database for conversation history
  - `messages` table: id, role, content, created_at
  - Migrations via wrangler d1 migrations
- Load last N messages as context for each request
- Store `ANTHROPIC_API_KEY` as CF Worker secret
- Conversational AI assistant on Telegram

### Phase 4: Web Scraping Tool

- Define `scrape_url` tool schema for Claude
  - Parameters: url (required), selector (optional CSS selector)
- Implement scraping with `fetch` + `HTMLRewriter`
  - Extract text content or targeted elements
  - Handle errors (timeouts, invalid URLs, non-HTML responses)
- KV caching for scrape results
  - Key: `scrape:{url_hash}`, configurable TTL
- Claude can now scrape URLs when asked via natural language

### Phase 5: Alerts and Scheduling

- Add Cron Trigger to `wrangler.jsonc`
  - `scheduled` handler in worker entry
- Define `create_alert` tool schema for Claude
  - Parameters: url, condition (natural language), check_interval_minutes
- D1 tables:
  - `alerts`: id, url, condition, check_interval_minutes, last_checked_at, last_value, active, created_at
  - `task_results`: id, task_type, input (JSON), output (JSON), status, created_at
- Scheduled handler:
  - Query active alerts from D1
  - Fetch each URL, evaluate condition (via Claude or simple comparison)
  - Send Telegram notification if condition met
- CF Queue for async task processing (if needed for heavy work)
- Additional tools: `list_alerts`, `delete_alert`

### Phase 6: Polish

- Error handling and retry logic
- Rate limiting via KV
- Conversation pruning (keep last N messages in context)
- Monitoring via CF Worker analytics
- Additional tools as needed (reminders, calculations, summaries)
