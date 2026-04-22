import { describe, expect, it } from "vitest";

import { computeNextRun, createScheduleSchema } from "./schedule";

describe("computeNextRun", () => {
  describe("hourly", () => {
    it("returns current hour if minute hasn't passed", () => {
      const from = new Date("2026-04-05T10:15:00Z");
      const result = computeNextRun("hourly", "UTC", from, { minute: 30 });
      expect(result.toISOString()).toBe("2026-04-05T10:30:00.000Z");
    });

    it("returns next hour if minute has passed", () => {
      const from = new Date("2026-04-05T10:45:00Z");
      const result = computeNextRun("hourly", "UTC", from, { minute: 30 });
      expect(result.toISOString()).toBe("2026-04-05T11:30:00.000Z");
    });

    it("defaults to minute 0", () => {
      const from = new Date("2026-04-05T10:01:00Z");
      const result = computeNextRun("hourly", "UTC", from, {});
      expect(result.toISOString()).toBe("2026-04-05T11:00:00.000Z");
    });

    it("handles midnight rollover", () => {
      const from = new Date("2026-04-05T23:45:00Z");
      const result = computeNextRun("hourly", "UTC", from, { minute: 30 });
      expect(result.toISOString()).toBe("2026-04-06T00:30:00.000Z");
    });
  });

  describe("daily", () => {
    it("returns today if time hasn't passed", () => {
      const from = new Date("2026-04-05T06:00:00Z");
      const result = computeNextRun("daily", "UTC", from, {
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-05T09:00:00.000Z");
    });

    it("returns tomorrow if time has passed", () => {
      const from = new Date("2026-04-05T10:00:00Z");
      const result = computeNextRun("daily", "UTC", from, {
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-06T09:00:00.000Z");
    });

    it("handles timezone offset (Europe/Helsinki = UTC+3 in summer)", () => {
      // 9:00 Helsinki = 6:00 UTC (EEST = UTC+3)
      const from = new Date("2026-04-05T05:00:00Z"); // 8:00 Helsinki
      const result = computeNextRun("daily", "Europe/Helsinki", from, {
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-05T06:00:00.000Z");
    });
  });

  describe("weekly", () => {
    it("returns this week if day hasn't passed", () => {
      // 2026-04-05 is a Sunday (dayOfWeek=0)
      const from = new Date("2026-04-05T10:00:00Z");
      const result = computeNextRun("weekly", "UTC", from, {
        dayOfWeek: 1, // Monday
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-06T09:00:00.000Z");
    });

    it("returns next week if same day but time has passed", () => {
      // 2026-04-06 is Monday
      const from = new Date("2026-04-06T10:00:00Z");
      const result = computeNextRun("weekly", "UTC", from, {
        dayOfWeek: 1, // Monday
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-13T09:00:00.000Z");
    });

    it("returns same day if time hasn't passed", () => {
      // 2026-04-06 is Monday
      const from = new Date("2026-04-06T08:00:00Z");
      const result = computeNextRun("weekly", "UTC", from, {
        dayOfWeek: 1,
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-06T09:00:00.000Z");
    });
  });

  describe("monthly", () => {
    it("returns this month if day hasn't passed", () => {
      const from = new Date("2026-04-03T10:00:00Z");
      const result = computeNextRun("monthly", "UTC", from, {
        dayOfMonth: 15,
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-04-15T09:00:00.000Z");
    });

    it("returns next month if day has passed", () => {
      const from = new Date("2026-04-20T10:00:00Z");
      const result = computeNextRun("monthly", "UTC", from, {
        dayOfMonth: 15,
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-05-15T09:00:00.000Z");
    });

    it("returns next month if same day but time has passed", () => {
      const from = new Date("2026-04-15T10:00:00Z");
      const result = computeNextRun("monthly", "UTC", from, {
        dayOfMonth: 15,
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2026-05-15T09:00:00.000Z");
    });

    it("handles year rollover", () => {
      const from = new Date("2026-12-20T10:00:00Z");
      const result = computeNextRun("monthly", "UTC", from, {
        dayOfMonth: 15,
        hour: 9,
        minute: 0,
      });
      expect(result.toISOString()).toBe("2027-01-15T09:00:00.000Z");
    });
  });

  describe("DST transitions", () => {
    it("handles spring-forward (Europe/Helsinki)", () => {
      // 2026 EEST starts last Sunday in March = 2026-03-29
      // Clocks spring forward from 3:00 to 4:00
      // Scheduling at 3:30 should land on 4:30 (or next valid time)
      const from = new Date("2026-03-29T00:00:00Z"); // Before DST
      const result = computeNextRun("daily", "Europe/Helsinki", from, {
        hour: 3,
        minute: 30,
      });
      // 3:30 doesn't exist due to spring-forward, should resolve to a valid time
      expect(result.getTime()).toBeGreaterThan(from.getTime());
    });

    it("handles fall-back (Europe/Helsinki)", () => {
      // 2026 EET starts last Sunday in October = 2026-10-25
      // Clocks fall back from 4:00 to 3:00
      const from = new Date("2026-10-24T20:00:00Z");
      const result = computeNextRun("daily", "Europe/Helsinki", from, {
        hour: 2,
        minute: 30,
      });
      expect(result.getTime()).toBeGreaterThan(from.getTime());
      // Verify the result is on Oct 25
      expect(result.toISOString()).toMatch(/2026-10-25/);
    });
  });
});

describe("createScheduleSchema", () => {
  const base = {
    scheduleType: "daily" as const,
    hour: 9,
    minute: 0,
    timezone: "UTC",
    description: "test",
  };

  it("accepts valid reminder with fixedMessage", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      fixedMessage: "Hello!",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid reminder with messagePrompt", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      messagePrompt: "Generate a greeting",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid monitor with sourceUrl + messagePrompt", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      sourceUrl: "https://example.com",
      messagePrompt: "Summarize changes",
    });
    expect(result.success).toBe(true);
  });

  it("rejects monitor with sourceUrl + fixedMessage", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      sourceUrl: "https://example.com",
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when both fixedMessage and messagePrompt set (no sourceUrl)", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      fixedMessage: "Hello",
      messagePrompt: "Generate",
    });
    expect(result.success).toBe(false);
  });

  it("accepts monitor with sourceUrl + messagePrompt + keywords", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      sourceUrl: "https://example.com",
      messagePrompt: "Check for Beck",
      keywords: ["Beck"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts monitor with empty keywords array", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      sourceUrl: "https://example.com",
      messagePrompt: "Summarize changes",
      keywords: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects keywords without sourceUrl", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      fixedMessage: "Hello",
      keywords: ["Beck"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when neither fixedMessage nor messagePrompt set", () => {
    const result = createScheduleSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("rejects daily without hour", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      hour: undefined,
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weekly without dayOfWeek", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      scheduleType: "weekly",
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects monthly without dayOfMonth", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      scheduleType: "monthly",
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("accepts weekly with dayOfWeek", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      scheduleType: "weekly",
      dayOfWeek: 1,
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts monthly with dayOfMonth", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      scheduleType: "monthly",
      dayOfMonth: 15,
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts hourly without hour", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      scheduleType: "hourly",
      hour: undefined,
      minute: 30,
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid timezone", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      timezone: "Not/A/Timezone",
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects description over 200 chars", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      description: "x".repeat(201),
      fixedMessage: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects fixedMessage over 4000 chars", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      fixedMessage: "x".repeat(4001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects messagePrompt over 500 chars", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      messagePrompt: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects sourceUrl over 2048 chars", () => {
    const result = createScheduleSchema.safeParse({
      ...base,
      sourceUrl: "https://example.com/" + "x".repeat(2048),
      messagePrompt: "test",
    });
    expect(result.success).toBe(false);
  });
});
