import type { Logger } from "@repo/logger";
import { z } from "zod";

import { HttpClient, HttpClientError } from "../http-client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const createJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

const schema = z.object({ ok: z.boolean() });

describe("HttpClient", () => {
  let logger: Logger;
  let client: HttpClient;

  beforeEach(() => {
    mockFetch.mockReset();
    logger = createMockLogger();
    client = new HttpClient({
      logger,
      baseUrl: "https://api.example.com",
      headers: { "Content-Type": "application/json" },
    });
  });

  describe("get", () => {
    it("sends a GET request and returns validated response", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      const result = await client.get("/status", { schema });

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
    });

    it("does not include body in GET requests", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await client.get("/status", { schema });

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.body).toBeUndefined();
    });
  });

  describe("post", () => {
    it("sends a POST request with body and returns validated response", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      const result = await client.post("/action", {
        schema,
        body: { key: "value" },
      });

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
      });
    });
  });

  describe("url construction", () => {
    it("concatenates baseUrl and path", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await client.get("/foo/bar", { schema });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/foo/bar",
        expect.any(Object)
      );
    });

    it("works without baseUrl", async () => {
      const noBaseClient = new HttpClient({ logger });
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await noBaseClient.get("https://other.com/api", { schema });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://other.com/api",
        expect.any(Object)
      );
    });
  });

  describe("headers", () => {
    it("merges default and per-request headers with per-request winning", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await client.get("/test", {
        schema,
        headers: { "Content-Type": "text/plain", "X-Custom": "yes" },
      });

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toEqual({
        "Content-Type": "text/plain",
        "X-Custom": "yes",
      });
    });
  });

  describe("error handling", () => {
    it("throws HttpClientError on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ error: "not found" }, 404)
      );

      await expect(client.get("/missing", { schema })).rejects.toThrow(
        HttpClientError
      );

      try {
        mockFetch.mockResolvedValueOnce(
          createJsonResponse({ error: "fail" }, 500)
        );
        await client.get("/fail", { schema });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpClientError);
        expect((err as HttpClientError).status).toBe(500);
        expect((err as HttpClientError).body).toEqual({ error: "fail" });
      }
    });

    it("throws on schema validation failure", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ unexpected: "shape" })
      );

      await expect(client.get("/bad", { schema })).rejects.toThrow();
    });
  });

  describe("logging", () => {
    it("logs debug on outgoing request and successful response", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await client.get("/test", { schema });

      expect(logger.debug).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledWith("outgoing request", {
        method: "GET",
        path: "/test",
      });
      expect(logger.debug).toHaveBeenCalledWith("request succeeded", {
        method: "GET",
        path: "/test",
        status: 200,
      });
    });

    it("logs error on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ error: "bad" }, 400)
      );

      await expect(client.get("/fail", { schema })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith("request failed", {
        method: "GET",
        path: "/fail",
        status: 400,
        body: { error: "bad" },
      });
    });
  });
});
