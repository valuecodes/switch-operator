import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "../types/env";

export const onErrorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const logger = c.get("logger");
  const requestId = c.get("requestId");
  const status = err instanceof HTTPException ? err.status : 500;

  logger.error("unhandled error", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    error: err.message,
    stack: err.stack,
  });

  if (err instanceof HTTPException) {
    const response = err.getResponse();
    return c.newResponse(response.body, response);
  }

  return c.json({ error: "Internal Server Error" }, 500);
};

export const notFoundHandler = (c: Context<AppEnv>) => {
  return c.json({ error: "Not Found" }, 404);
};
