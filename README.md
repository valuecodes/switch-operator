# switch-operator

Personal AI assistant that communicates via Telegram, runs on Cloudflare Workers.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Language:** TypeScript (strict)
- **LLM:** Claude API
- **Validation:** Zod
- **Monorepo:** pnpm workspaces

## Structure

```
apps/
  operator/     # Cloudflare Worker (Telegram bot)
tooling/
  eslint/       # Shared ESLint config
  prettier/     # Shared Prettier config
  typescript/   # Shared TypeScript config
```

See [apps/operator/README.md](apps/operator/README.md) for setup and development instructions.
