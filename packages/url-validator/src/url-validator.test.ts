import { describe, expect, it } from "vitest";

import { validateSourceUrl } from "./url-validator";

describe("validateSourceUrl", () => {
  it("accepts valid HTTPS URL", () => {
    expect(validateSourceUrl("https://www.example.com/")).toEqual({
      valid: true,
    });
  });

  it("accepts HTTPS URL with path", () => {
    expect(
      validateSourceUrl("https://www.example.org/us/individual/insights")
    ).toEqual({ valid: true });
  });

  it("rejects HTTP URLs", () => {
    const result = validateSourceUrl("http://www.example.com/");
    expect(result).toEqual({
      valid: false,
      reason: "Only HTTPS URLs are allowed",
    });
  });

  it("rejects localhost", () => {
    const result = validateSourceUrl("https://localhost/");
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    const result = validateSourceUrl("https://127.0.0.1/");
    expect(result.valid).toBe(false);
  });

  it("rejects [::1]", () => {
    const result = validateSourceUrl("https://[::1]/");
    expect(result.valid).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    const result = validateSourceUrl("https://0.0.0.0/");
    expect(result.valid).toBe(false);
  });

  it("rejects URLs with credentials", () => {
    const result = validateSourceUrl("https://user:pass@example.com/");
    expect(result).toEqual({
      valid: false,
      reason: "URLs with credentials are not allowed",
    });
  });

  it("rejects URLs over 2048 chars", () => {
    const result = validateSourceUrl("https://example.com/" + "a".repeat(2048));
    expect(result).toEqual({
      valid: false,
      reason: "URL exceeds 2048 character limit",
    });
  });

  it("rejects invalid URLs", () => {
    const result = validateSourceUrl("not-a-url");
    expect(result).toEqual({ valid: false, reason: "Invalid URL" });
  });

  it("rejects FTP URLs", () => {
    const result = validateSourceUrl("ftp://example.com/");
    expect(result).toEqual({
      valid: false,
      reason: "Only HTTPS URLs are allowed",
    });
  });

  it("rejects file URLs", () => {
    const result = validateSourceUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.2 (full loopback range)", () => {
    const result = validateSourceUrl("https://127.0.0.2/");
    expect(result.valid).toBe(false);
  });

  it("rejects 127.255.255.255 (loopback range upper bound)", () => {
    const result = validateSourceUrl("https://127.255.255.255/");
    expect(result.valid).toBe(false);
  });
});
