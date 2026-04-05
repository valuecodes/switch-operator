import { describe, expect, it } from "vitest";

import { parseAllowedDomains, validateSourceUrl } from "./url-validator";

const DOMAINS = ["telsu.fi", "blackrock.com"];

describe("validateSourceUrl", () => {
  it("accepts valid HTTPS URL on allowed domain", () => {
    expect(validateSourceUrl("https://www.telsu.fi/", DOMAINS)).toEqual({
      valid: true,
    });
  });

  it("accepts subdomain of allowed domain", () => {
    expect(
      validateSourceUrl(
        "https://www.blackrock.com/us/individual/insights",
        DOMAINS
      )
    ).toEqual({ valid: true });
  });

  it("accepts exact domain match", () => {
    expect(validateSourceUrl("https://telsu.fi/page", DOMAINS)).toEqual({
      valid: true,
    });
  });

  it("rejects HTTP URLs", () => {
    const result = validateSourceUrl("http://www.telsu.fi/", DOMAINS);
    expect(result).toEqual({
      valid: false,
      reason: "Only HTTPS URLs are allowed",
    });
  });

  it("rejects non-allowlisted domains", () => {
    const result = validateSourceUrl("https://evil.com/", DOMAINS);
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("rejects localhost", () => {
    const result = validateSourceUrl("https://localhost/", DOMAINS);
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    const result = validateSourceUrl("https://127.0.0.1/", DOMAINS);
    expect(result.valid).toBe(false);
  });

  it("rejects [::1]", () => {
    const result = validateSourceUrl("https://[::1]/", DOMAINS);
    expect(result.valid).toBe(false);
  });

  it("rejects URLs with credentials", () => {
    const result = validateSourceUrl("https://user:pass@telsu.fi/", DOMAINS);
    expect(result).toEqual({
      valid: false,
      reason: "URLs with credentials are not allowed",
    });
  });

  it("rejects URLs over 2048 chars", () => {
    const result = validateSourceUrl(
      "https://telsu.fi/" + "a".repeat(2048),
      DOMAINS
    );
    expect(result).toEqual({
      valid: false,
      reason: "URL exceeds 2048 character limit",
    });
  });

  it("rejects invalid URLs", () => {
    const result = validateSourceUrl("not-a-url", DOMAINS);
    expect(result).toEqual({ valid: false, reason: "Invalid URL" });
  });

  it("rejects FTP URLs", () => {
    const result = validateSourceUrl("ftp://telsu.fi/", DOMAINS);
    expect(result).toEqual({
      valid: false,
      reason: "Only HTTPS URLs are allowed",
    });
  });

  it("rejects file URLs", () => {
    const result = validateSourceUrl("file:///etc/passwd", DOMAINS);
    expect(result.valid).toBe(false);
  });

  it("rejects when allowed domains list is empty", () => {
    const result = validateSourceUrl("https://telsu.fi/", []);
    expect(result.valid).toBe(false);
  });

  it("prevents domain suffix attacks (eviltelsu.fi)", () => {
    const result = validateSourceUrl("https://eviltelsu.fi/", DOMAINS);
    expect(result.valid).toBe(false);
  });
});

describe("parseAllowedDomains", () => {
  it("parses comma-separated domains", () => {
    expect(parseAllowedDomains("telsu.fi,blackrock.com")).toEqual([
      "telsu.fi",
      "blackrock.com",
    ]);
  });

  it("trims whitespace", () => {
    expect(parseAllowedDomains(" telsu.fi , blackrock.com ")).toEqual([
      "telsu.fi",
      "blackrock.com",
    ]);
  });

  it("returns empty array for undefined", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAllowedDomains("")).toEqual([]);
  });
});
