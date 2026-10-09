const SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Get the current local parts (hour, minute, day-of-week, day-of-month, etc.)
 * for a given Date in a given timezone.
 */
const getLocalParts = (date: Date, timezone: string) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayOfWeek:
      parts.weekday === undefined ? 0 : (WEEKDAY_MAP[parts.weekday] ?? 0),
  };
};

/**
 * Build a UTC Date from local parts in a given timezone.
 * Uses the timezone offset to convert local -> UTC.
 */
const localToUtc = (
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date => {
  // Start with a guess: treat local parts as UTC
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Find the offset by checking what local time the guess maps to
  const localParts = getLocalParts(guess, timezone);
  const localAsUtc = new Date(
    Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute,
      localParts.second,
      0
    )
  );

  const offsetMs = localAsUtc.getTime() - guess.getTime();
  const result = new Date(guess.getTime() - offsetMs);

  // Verify by round-tripping: the result, viewed in the target timezone,
  // should show the desired hour. If DST caused a shift (spring-forward),
  // the hour won't match — advance by 1 hour.
  const verify = getLocalParts(result, timezone);
  if (verify.hour !== hour) {
    // Spring-forward: the target hour doesn't exist. Advance to the next valid hour.
    const diff = ((hour - verify.hour + 24) % 24) * 60 * 60 * 1000;
    return new Date(result.getTime() + diff);
  }

  return result;
};

const computeNextRun = (
  scheduleType: ScheduleType,
  timezone: string,
  from: Date,
  opts: {
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  }
): Date => {
  const minute = opts.minute ?? 0;

  if (scheduleType === "hourly") {
    // Next occurrence of :MM after `from`
    const local = getLocalParts(from, timezone);
    if (local.minute < minute) {
      // Still in the current hour
      return localToUtc(
        timezone,
        local.year,
        local.month,
        local.day,
        local.hour,
        minute
      );
    }
    // Next hour
    const next = new Date(from.getTime() + 60 * 60 * 1000);
    const nextLocal = getLocalParts(next, timezone);
    return localToUtc(
      timezone,
      nextLocal.year,
      nextLocal.month,
      nextLocal.day,
      nextLocal.hour,
      minute
    );
  }

  const hour = opts.hour ?? 0;

  if (scheduleType === "daily") {
    const local = getLocalParts(from, timezone);
    // Try today
    const candidate = localToUtc(
      timezone,
      local.year,
      local.month,
      local.day,
      hour,
      minute
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
    // Tomorrow
    const tomorrow = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const tLocal = getLocalParts(tomorrow, timezone);
    return localToUtc(
      timezone,
      tLocal.year,
      tLocal.month,
      tLocal.day,
      hour,
      minute
    );
  }

  if (scheduleType === "weekly") {
    const targetDay = opts.dayOfWeek ?? 0;
    const local = getLocalParts(from, timezone);

    // Try this week
    let daysAhead = (targetDay - local.dayOfWeek + 7) % 7;
    if (daysAhead === 0) {
      // Same day — check if time hasn't passed
      const candidate = localToUtc(
        timezone,
        local.year,
        local.month,
        local.day,
        hour,
        minute
      );
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
      daysAhead = 7;
    }

    const target = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const tLocal = getLocalParts(target, timezone);
    return localToUtc(
      timezone,
      tLocal.year,
      tLocal.month,
      tLocal.day,
      hour,
      minute
    );
  }

  // monthly
  const targetDom = opts.dayOfMonth ?? 1;
  const local = getLocalParts(from, timezone);

  // Try this month
  if (local.day <= targetDom) {
    const candidate = localToUtc(
      timezone,
      local.year,
      local.month,
      targetDom,
      hour,
      minute
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }

  // Next month
  let nextMonth = local.month + 1;
  let nextYear = local.year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }
  return localToUtc(timezone, nextYear, nextMonth, targetDom, hour, minute);
};

export { computeNextRun, SCHEDULE_TYPES };
