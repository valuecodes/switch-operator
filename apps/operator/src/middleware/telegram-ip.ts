import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../types/env";

/**
 * Official Telegram IPv4 CIDR ranges.
 * Source: https://core.telegram.org/resources/cidr.txt
 *
 * Telegram only publishes IPv4 ranges. IPv6 addresses from CF-Connecting-IP
 * will fail to parse and be correctly rejected with 403.
 */
const TELEGRAM_CIDRS = [
  "91.105.192.0/23",
  "91.108.4.0/22",
  "91.108.8.0/22",
  "91.108.12.0/22",
  "91.108.16.0/22",
  "91.108.20.0/22",
  "91.108.56.0/22",
  "149.154.160.0/20",
  "185.76.151.0/24",
] as const;

type CidrEntry = {
  network: number;
  mask: number;
};

const parseCidr = (cidr: string): CidrEntry => {
  const [ip, prefix] = cidr.split("/");
  const parts = ip.split(".").map(Number);
  const network =
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = (~0 << (32 - Number(prefix))) >>> 0;
  return { network, mask };
};

const parsedCidrs = TELEGRAM_CIDRS.map(parseCidr);

const ipToNumber = (ip: string): number => {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
};

const isInTelegramRange = (ip: string): boolean => {
  const ipNum = ipToNumber(ip);
  return parsedCidrs.some(
    ({ network, mask }) => (ipNum & mask) >>> 0 === network
  );
};

/**
 * Restricts access to requests originating from Telegram's IP ranges.
 * Uses the CF-Connecting-IP header set by Cloudflare.
 */
export const telegramIpMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const ip = c.req.header("cf-connecting-ip");

    if (!ip || !isInTelegramRange(ip)) {
      c.get("logger").warn("rejected request from non-Telegram IP", {
        ip: ip ?? "unknown",
      });
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  }
);
