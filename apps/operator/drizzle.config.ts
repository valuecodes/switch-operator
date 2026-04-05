import { defineConfig } from "drizzle-kit";

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  out: "./migrations",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
});
