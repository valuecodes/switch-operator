import { Hono } from "hono";

import type { AppEnv } from "../../types/env";
import { getHealth } from "./controller";

const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/health", getHealth);

export { healthRoutes };
