import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { corsMiddleware } from "../cors";

const createApp = () => {
  const app = new Hono();
  app.use("*", corsMiddleware);
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.post("/webhook/telegram", (c) => c.json({ ok: true }));
  return app;
};

describe("corsMiddleware", () => {
  it("does not set Access-Control-Allow-Origin for requests without Origin", async () => {
    const app = createApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not allow cross-origin requests", async () => {
    const app = createApp();
    const res = await app.request("/health", {
      headers: { Origin: "https://evil.com" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not set CORS headers on preflight requests", async () => {
    const app = createApp();
    const res = await app.request("/webhook/telegram", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
