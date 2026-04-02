import { cors } from "hono/cors";

/**
 * CORS middleware that rejects all cross-origin requests.
 * This worker is an API-only backend with no browser clients.
 */
export const corsMiddleware = cors({
  origin: [],
});
