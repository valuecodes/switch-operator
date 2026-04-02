# switch-operator

Cloudflare Worker-based Telegram operator. The current implementation provides
health checks, Telegram webhook validation, Telegram IP allowlisting, and echo
replies for one allowed chat; LLM-driven assistant features are planned next.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Language:** TypeScript (strict)
- **Messaging:** Telegram Bot API
- **LLM:** Claude API (planned)
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

See [apps/operator/README.md](apps/operator/README.md) for setup and development instructions.
