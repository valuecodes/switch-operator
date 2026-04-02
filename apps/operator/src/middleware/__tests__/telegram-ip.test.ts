import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../types/env";
import { loggerMiddleware } from "../logger";
import { telegramIpMiddleware } from "../telegram-ip";

const createApp = () => {
  const app = new Hono<AppEnv>();
  app.use("*", loggerMiddleware);
  app.post("/webhook/telegram", telegramIpMiddleware, (c) =>
    c.json({ ok: true })
  );
  return app;
};

const sendRequest = (app: Hono<AppEnv>, ip?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ip) {
    headers["cf-connecting-ip"] = ip;
  }
  return app.request("/webhook/telegram", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
};

describe("telegramIpMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 403 when cf-connecting-ip header is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    const res = await sendRequest(app);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 403 for non-Telegram IP address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    const res = await sendRequest(app, "8.8.8.8");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("allows request from Telegram IP in 149.154.160.0/20", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    const res = await sendRequest(app, "149.154.167.50");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows request from Telegram IP in 91.108.4.0/22", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    const res = await sendRequest(app, "91.108.5.1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects IP just outside Telegram range", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    // 149.154.176.0 is just outside 149.154.160.0/20
    const res = await sendRequest(app, "149.154.176.1");

    expect(res.status).toBe(403);
  });

  it("logs warning with rejected IP", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = createApp();
    await sendRequest(app, "1.2.3.4");

    expect(warnSpy).toHaveBeenCalled();
    const output = String(warnSpy.mock.calls[0]?.[0]);
    expect(output).toContain("rejected request from non-Telegram IP");
  });
});
