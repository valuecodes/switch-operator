# Operator

Cloudflare Worker that acts as a Telegram operator via Hono. The current
implementation validates Telegram webhook requests, sends OpenAI-backed replies
to a single allowed chat, stores schedules in Cloudflare D1, and runs reminders
plus web monitors on a cron trigger.

Run commands from the repo root unless noted otherwise.

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Create `.dev.vars` (gitignored):
   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_WEBHOOK_SECRET=<random string with at least 32 characters>
   ALLOWED_CHAT_ID=<your Telegram user ID>
   OPENAI_API_KEY=<your OpenAI API key>
   ```
3. Install dependencies from repo root: `pnpm install`
4. Apply local D1 migrations before testing schedule features:
   ```sh
   pnpm --filter @repo/operator db:migrate:local
   ```

## Current Behavior

- `GET /health` returns `{ "status": "ok" }`
- `POST /webhook/telegram` only accepts requests from Telegram IP ranges
- The webhook requires the `X-Telegram-Bot-Api-Secret-Token` header to match
- The webhook body is limited to 64 KiB and validated against the Telegram update schema
- Messages from the allowed Telegram chat are forwarded to OpenAI
- The assistant can create, list, and delete scheduled reminders through tool calls
- Schedule creation and deletion require a `YES` confirmation reply within two minutes
- A cron trigger runs every minute and executes due reminders and web monitors from D1
- Monitor schedules scrape a URL, analyze the content with OpenAI, and notify only when the condition matches

## Local Development

Requires two terminals and [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

**Terminal 1** - start the worker:

```sh
pnpm dev
```

**Terminal 2** - start a tunnel:

```sh
cloudflared tunnel --url http://localhost:8787
```

Then register the webhook with the tunnel URL:

```sh
pnpm --filter @repo/operator set-webhook <tunnel-url>
# e.g. pnpm --filter @repo/operator set-webhook https://xxx.trycloudflare.com
```

Send a message to your bot on Telegram. The worker will send the message text to
OpenAI and reply in Telegram with the model output. Schedule creation,
deletion, and monitoring features require the local D1 migrations above.

## Production

Set secrets via Wrangler CLI:

```sh
pnpm --filter @repo/operator exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm --filter @repo/operator exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm --filter @repo/operator exec wrangler secret put ALLOWED_CHAT_ID
pnpm --filter @repo/operator exec wrangler secret put OPENAI_API_KEY
```

Apply remote D1 migrations before or after deploy:

```sh
pnpm --filter @repo/operator db:migrate:remote
```

Create `.prod.vars` (gitignored) with your production bot credentials, then deploy and register the webhook:

```sh
pnpm --filter @repo/operator deploy
pnpm --filter @repo/operator set-webhook \
  https://switch-operator.<account>.workers.dev -- --prod
```

## Scripts

| Command                                                      | Description                   |
| ------------------------------------------------------------ | ----------------------------- |
| `pnpm dev`                                                   | Start local dev server        |
| `pnpm --filter @repo/operator deploy`                        | Deploy to Cloudflare Workers  |
| `pnpm --filter @repo/operator db:migrate:local`              | Apply local D1 migrations     |
| `pnpm --filter @repo/operator db:migrate:remote`             | Apply remote D1 migrations    |
| `pnpm typecheck`                                             | Run TypeScript type checking  |
| `pnpm lint`                                                  | Run ESLint                    |
| `pnpm test`                                                  | Run tests                     |
| `pnpm --filter @repo/operator set-webhook <url> [-- --prod]` | Register Telegram webhook URL |

## Endpoints

| Method | Path                | Description               |
| ------ | ------------------- | ------------------------- |
| GET    | `/health`           | Health check              |
| POST   | `/webhook/telegram` | Telegram webhook receiver |
