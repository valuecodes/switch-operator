import { Hono } from "hono";

import { envValidator } from "./middleware/env";
import { notFoundHandler, onErrorHandler } from "./middleware/error-handlers";
import { loggerMiddleware } from "./middleware/logger";
import { healthRoutes } from "./modules/health/routes";
import { telegramRoutes } from "./modules/telegram/routes";
import type { AppEnv } from "./types/env";

const app = new Hono<AppEnv>();

app.use("*", loggerMiddleware);
app.use("*", envValidator());
app.onError(onErrorHandler);

app.route("/", healthRoutes);
app.route("/", telegramRoutes);

app.notFound(notFoundHandler);

// eslint-disable-next-line import/no-default-export
export default app;
