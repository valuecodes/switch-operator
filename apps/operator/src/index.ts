import { Hono } from "hono";

import { envValidator } from "./middleware/env";
import { healthRoutes } from "./modules/health/routes";
import { telegramRoutes } from "./modules/telegram/routes";
import type { AppEnv } from "./types/env";

const app = new Hono<AppEnv>();

app.use("*", envValidator());

app.route("/", healthRoutes);
app.route("/", telegramRoutes);

// eslint-disable-next-line import/no-default-export
export default app;
