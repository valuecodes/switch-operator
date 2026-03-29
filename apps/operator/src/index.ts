import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// eslint-disable-next-line import/no-default-export
export default app;
