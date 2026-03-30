import { secureHeaders } from "hono/secure-headers";

/**
 * Secure headers configured for an API-only worker.
 * Disables X-Frame-Options and X-XSS-Protection as they are
 * irrelevant for non-HTML responses.
 */
export const secureHeadersMiddleware = secureHeaders({
  xFrameOptions: false,
  xXssProtection: false,
});
