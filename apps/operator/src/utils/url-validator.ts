/**
 * Validates a source URL against the SSRF safety policy:
 * - HTTPS only
 * - Hostname must be in the allowed domains list
 * - Max 2048 characters
 *
 * DNS-level private IP checks are deferred to the fetch layer
 * (Cloudflare Workers already block fetches to private IPs).
 */
const validateSourceUrl = (
  url: string,
  allowedDomains: string[]
): { valid: true } | { valid: false; reason: string } => {
  if (url.length > 2048) {
    return { valid: false, reason: "URL exceeds 2048 character limit" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Only HTTPS URLs are allowed" };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URLs with credentials are not allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  ) {
    return { valid: false, reason: "Localhost URLs are not allowed" };
  }

  const isAllowed = allowedDomains.some((domain) => {
    const d = domain.toLowerCase();
    return hostname === d || hostname.endsWith(`.${d}`);
  });

  if (!isAllowed) {
    return {
      valid: false,
      reason: `Domain "${hostname}" is not in the allowed list`,
    };
  }

  return { valid: true };
};

const parseAllowedDomains = (envValue: string | undefined): string[] => {
  if (!envValue) {
    return [];
  }
  return envValue
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
};

export { parseAllowedDomains, validateSourceUrl };
