/**
 * Safely parse the keywords JSON column.
 * Returns [] on null, undefined, or malformed data. Never throws.
 */
const parseKeywords = (raw: string | null | undefined): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
};

/**
 * Find all positions of keywords in text (case-insensitive).
 */
const findKeywordPositions = (text: string, keywords: string[]): number[] => {
  const lower = text.toLowerCase();
  const positions: number[] = [];

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let idx = lower.indexOf(kwLower);
    while (idx !== -1) {
      positions.push(idx);
      idx = lower.indexOf(kwLower, idx + 1);
    }
  }

  return positions;
};

/**
 * Extract text windows around the given positions, merging overlaps.
 * Returns the joined snippets separated by "---".
 */
const extractWindows = (
  text: string,
  positions: number[],
  windowSize: number
): string => {
  if (positions.length === 0) {
    return "";
  }

  // Build ranges clamped to text bounds
  const ranges = positions
    .map(
      (pos) =>
        [
          Math.max(0, pos - windowSize),
          Math.min(text.length, pos + windowSize),
        ] as const
    )
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping ranges
  const merged: [number, number][] = [[ranges[0][0], ranges[0][1]]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push([ranges[i][0], ranges[i][1]]);
    }
  }

  return merged
    .map(([start, end]) => text.slice(start, end))
    .join("\n\n---\n\n");
};

export { extractWindows, findKeywordPositions, parseKeywords };
