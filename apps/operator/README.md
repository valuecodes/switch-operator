# Operator

Cloudflare Worker that acts as a Telegram operator via Hono. The current
implementation validates Telegram webhook requests and echoes messages back to a
single allowed chat.

Run commands from the repo root unless noted otherwise.

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Create `.dev.vars` (gitignored):
   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_WEBHOOK_SECRET=<random string with at least 32 characters>
   ALLOWED_CHAT_ID=<your Telegram user ID>
   ```
3. Install dependencies from repo root: `pnpm install`

## Current Behavior

- `GET /health` returns `{ "status": "ok" }`
- `POST /webhook/telegram` only accepts requests from Telegram IP ranges
- The webhook requires the `X-Telegram-Bot-Api-Secret-Token` header to match
- Messages are echoed only when the Telegram chat ID matches `ALLOWED_CHAT_ID`

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

Send a message to your bot on Telegram - it should echo it back.

## Production

Set secrets via Wrangler CLI:

```sh
pnpm --filter @repo/operator exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm --filter @repo/operator exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm --filter @repo/operator exec wrangler secret put ALLOWED_CHAT_ID
```

Create `.prod.vars` (gitignored) with your production bot credentials, then register the webhook:

```sh
pnpm --filter @repo/operator set-webhook \
  https://switch-operator.<account>.workers.dev -- --prod
```

## Scripts

| Command                                                      | Description                   |
| ------------------------------------------------------------ | ----------------------------- |
| `pnpm dev`                                                   | Start local dev server        |
| `pnpm --filter @repo/operator deploy`                        | Deploy to Cloudflare Workers  |
| `pnpm typecheck`                                             | Run TypeScript type checking  |
| `pnpm lint`                                                  | Run ESLint                    |
| `pnpm test`                                                  | Run tests                     |
| `pnpm --filter @repo/operator set-webhook <url> [-- --prod]` | Register Telegram webhook URL |

## Endpoints

| Method | Path                | Description               |
| ------ | ------------------- | ------------------------- |
| GET    | `/health`           | Health check              |
| POST   | `/webhook/telegram` | Telegram webhook receiver |
