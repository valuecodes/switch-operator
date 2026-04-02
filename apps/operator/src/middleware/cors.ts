import { cors } from "hono/cors";

/**
 * CORS middleware that omits all Access-Control-Allow-Origin headers.
 * Browsers will block cross-origin responses due to the missing headers.
 * This worker is an API-only backend with no browser clients.
 */
export const corsMiddleware = cors({
  origin: [],
});
