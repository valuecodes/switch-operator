/**
 * Validates a source URL against the safety policy:
 * - HTTPS only
 * - No localhost / loopback addresses
 * - No credentials in URL
 * - Max 2048 characters
 *
 * DNS-level private IP checks are deferred to the fetch layer
 * (Cloudflare Workers already block fetches to private IPs).
 */
const validateSourceUrl = (
  url: string
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

  return { valid: true };
};

export { validateSourceUrl };
