import type { Logger } from "@repo/logger";
import type { z } from "zod";

type HttpClientConfig = {
  logger: Logger;
  baseUrl?: string;
  headers?: Record<string, string>;
};

type RequestOptions<T extends z.ZodType> = {
  schema: T;
  headers?: Record<string, string>;
};

type PostOptions<T extends z.ZodType> = RequestOptions<T> & {
  body: Record<string, unknown>;
};

export type { HttpClientConfig, PostOptions, RequestOptions };
