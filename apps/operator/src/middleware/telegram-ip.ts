import { createMiddleware } from "hono/factory";

import type { AppEnv } from "~/types/env";

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

// Missing octets count as 0, matching how bitwise ops coerce undefined/NaN.
const ipToNumber = (ip: string): number => {
  const [a = 0, b = 0, c = 0, d = 0] = ip.split(".").map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
};

const parseCidr = (cidr: string): CidrEntry => {
  const [ip, prefix] = cidr.split("/");
  if (ip === undefined || prefix === undefined) {
    throw new Error(`Malformed CIDR: ${cidr}`);
  }
  const network = ipToNumber(ip);
  const mask = (~0 << (32 - Number(prefix))) >>> 0;
  return { network, mask };
};

const parsedCidrs = TELEGRAM_CIDRS.map(parseCidr);

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

    if (ip === undefined || ip === "" || !isInTelegramRange(ip)) {
      c.get("logger").warn("rejected request from non-Telegram IP", {
        ip: ip ?? "unknown",
      });
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  }
);
