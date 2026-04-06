# switch-operator

Cloudflare Worker-based Telegram operator for one allowed Telegram chat. The
current implementation provides health checks, Telegram webhook validation,
OpenAI-backed replies, scheduled reminders, and website monitoring backed by
Cloudflare D1.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Language:** TypeScript (strict)
- **Messaging:** Telegram Bot API
- **LLM:** OpenAI API
- **Validation:** Zod
- **Monorepo:** pnpm workspaces

## Structure

```
apps/
  operator/     # Cloudflare Worker (Telegram bot)
packages/
  http-client/  # Shared fetch wrapper with response validation
  logger/       # Shared structured logger
tooling/
  eslint/       # Shared ESLint config
  prettier/     # Shared Prettier config
  typescript/   # Shared TypeScript config
```

## Flow

```mermaid
flowchart TD
  A[Telegram message] --> B[Validate webhook]
  B --> C[Load operator app]
  C --> D{Request type}
  D -->|Chat reply| E[OpenAI generates response]
  E --> F[Send Telegram reply]
  D -->|Create schedule| G[Store pending action]
  G --> H[User replies YES]
  H --> I[Save schedule in D1]
  I --> J[Cron checks due schedules]
  J --> K{Schedule kind}
  K -->|Reminder| L[Send reminder]
  K -->|Monitor| M[Scrape website and analyze]
  M --> N[Send monitor update]
```

## Development

Requires Node 24.12.0 (see `.nvmrc`) and pnpm.

```sh
pnpm install          # install dependencies
pnpm dev              # start local dev server
pnpm build            # build all workspaces
pnpm typecheck        # type checking
pnpm lint             # linting
pnpm test             # run tests
pnpm format:check     # check formatting
pnpm format           # fix formatting
```

For local Telegram bot testing you also need
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
to tunnel to your local worker. See
[apps/operator/README.md](apps/operator/README.md) for full setup instructions
(`.dev.vars`, D1 migrations, webhook registration, production secrets).
