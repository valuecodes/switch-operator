import type { Context } from "hono";

import type { AppEnv } from "../../types/env";

const getHealth = (c: Context<AppEnv>) => {
  return c.json({ status: "ok" });
};

export { getHealth };
