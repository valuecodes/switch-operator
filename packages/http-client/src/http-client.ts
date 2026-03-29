import type { Logger } from "@repo/logger";
import type { z } from "zod";

import type { HttpClientConfig, PostOptions, RequestOptions } from "./types";

export type { HttpClientConfig, PostOptions, RequestOptions } from "./types";

class HttpClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP error ${status}`);
    this.name = "HttpClientError";
    this.status = status;
    this.body = body;
  }
}

class HttpClient {
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: HttpClientConfig) {
    this.logger = config.logger;
    this.baseUrl = config.baseUrl ?? "";
    this.defaultHeaders = config.headers ?? {};
  }

  async get<T extends z.ZodType>(
    path: string,
    options: RequestOptions<T>
  ): Promise<z.infer<T>> {
    return this.request("GET", path, options);
  }

  async post<T extends z.ZodType>(
    path: string,
    options: PostOptions<T>
  ): Promise<z.infer<T>> {
    return this.request("POST", path, options);
  }

  private async request<T extends z.ZodType>(
    method: string,
    path: string,
    options: RequestOptions<T> & { body?: Record<string, unknown> }
  ): Promise<z.infer<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.defaultHeaders, ...options.headers };

    this.logger.debug("outgoing request", { method, path });

    const init: RequestInit = { method, headers };
    if (options.body) {
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);

    const json: unknown = await response.json();

    if (!response.ok) {
      this.logger.error("request failed", {
        method,
        path,
        status: response.status,
        body: json,
      });
      throw new HttpClientError(response.status, json);
    }

    this.logger.debug("request succeeded", {
      method,
      path,
      status: response.status,
    });

    return options.schema.parse(json) as z.infer<T>;
  }
}

export { HttpClient, HttpClientError };
