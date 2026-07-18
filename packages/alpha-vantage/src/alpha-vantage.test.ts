import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaVantageClient, AlphaVantageError } from "./alpha-vantage";

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

const dailySuccessBody = {
  "Meta Data": {
    "1. Information": "Daily Prices (open, high, low, close) and Volumes",
    "2. Symbol": "SPY",
    "3. Last Refreshed": "2024-01-05",
    "4. Output Size": "Compact",
    "5. Time Zone": "US/Eastern",
  },
  "Time Series (Daily)": {
    "2024-01-04": {
      "1. open": "467.9900",
      "2. high": "470.7500",
      "3. low": "466.4300",
      "4. close": "467.9200",
      "5. volume": "85337630",
    },
    "2024-01-05": {
      "1. open": "468.3000",
      "2. high": "469.1300",
      "3. low": "464.4500",
      "4. close": "467.2800",
      "5. volume": "92955850",
    },
  },
};

const weeklySuccessBody = {
  "Meta Data": {
    "1. Information": "Weekly Prices (open, high, low, close) and Volumes",
    "2. Symbol": "SPY",
    "3. Last Refreshed": "2024-01-05",
    "4. Time Zone": "US/Eastern",
  },
  "Weekly Time Series": {
    "2023-12-29": {
      "1. open": "469.5200",
      "2. high": "477.5500",
      "3. low": "469.3200",
      "4. close": "475.3100",
      "5. volume": "312292710",
    },
    "2024-01-05": {
      "1. open": "472.9400",
      "2. high": "473.4000",
      "3. low": "464.4500",
      "4. close": "467.2800",
      "5. volume": "343549680",
    },
  },
};

describe("AlphaVantageClient", () => {
  let client: AlphaVantageClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new AlphaVantageClient("test-key", createMockLogger());
  });

  describe("getDailyTimeSeries", () => {
    it("normalizes a daily response with bars newest-first and numbers parsed", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse(dailySuccessBody));

      const series = await client.getDailyTimeSeries("SPY");

      expect(series.symbol).toBe("SPY");
      expect(series.lastRefreshed).toBe("2024-01-05");
      expect(series.timeZone).toBe("US/Eastern");
      expect(series.bars).toHaveLength(2);

      const [latest] = series.bars;
      expect(latest).toEqual({
        date: "2024-01-05",
        open: 468.3,
        high: 469.13,
        low: 464.45,
        close: 467.28,
        volume: 92955850,
      });
    });

    it("sends the expected query parameters", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse(dailySuccessBody));

      await client.getDailyTimeSeries("QQQ", { outputSize: "full" });

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain("https://www.alphavantage.co/query?");
      expect(url).toContain("function=TIME_SERIES_DAILY");
      expect(url).toContain("symbol=QQQ");
      expect(url).toContain("outputsize=full");
      expect(url).toContain("apikey=test-key");
    });

    it("throws AlphaVantageError on a rate-limit body", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({
          Information:
            "We have detected your API rate limit... 25 requests per day.",
        })
      );

      await expect(client.getDailyTimeSeries("SPY")).rejects.toThrow(
        AlphaVantageError
      );
    });

    it("throws AlphaVantageError on an invalid symbol", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({
          "Error Message":
            "Invalid API call. Please retry or visit the documentation.",
        })
      );

      await expect(client.getDailyTimeSeries("NOPE")).rejects.toThrow(
        AlphaVantageError
      );
    });
  });

  describe("getWeeklyTimeSeries", () => {
    it("normalizes a weekly response with bars newest-first and numbers parsed", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse(weeklySuccessBody));

      const series = await client.getWeeklyTimeSeries("SPY");

      expect(series.symbol).toBe("SPY");
      expect(series.lastRefreshed).toBe("2024-01-05");
      expect(series.timeZone).toBe("US/Eastern");
      expect(series.bars).toHaveLength(2);

      const [latest] = series.bars;
      expect(latest.date).toBe("2024-01-05");
      expect(latest.close).toBe(467.28);
    });

    it("sends the expected query parameters without outputsize", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse(weeklySuccessBody));

      await client.getWeeklyTimeSeries("SPY");

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain("https://www.alphavantage.co/query?");
      expect(url).toContain("function=TIME_SERIES_WEEKLY");
      expect(url).toContain("symbol=SPY");
      expect(url).toContain("apikey=test-key");
      expect(url).not.toContain("outputsize");
    });

    it("throws AlphaVantageError on a rate-limit body", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({
          Information:
            "We have detected your API rate limit... 25 requests per day.",
        })
      );

      await expect(client.getWeeklyTimeSeries("SPY")).rejects.toThrow(
        AlphaVantageError
      );
    });
  });
});
