import { defineConfig } from "vitest/config";

export default defineConfig({
  // `~/` resolves through tsconfig `paths`; Wrangler's bundler reads them too.
  resolve: { tsconfigPaths: true },
  test: { include: ["src/**/*.test.ts"] },
});
