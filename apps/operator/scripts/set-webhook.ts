import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const parseVarsFile = (path: string): Record<string, string> => {
  const content = readFileSync(path, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex !== -1) {
      vars[trimmed.slice(0, eqIndex).trim()] = trimmed
        .slice(eqIndex + 1)
        .trim();
    }
  }
  return vars;
};

const main = async () => {
  const args = process.argv.slice(2);
  const isProd = args.includes("--prod");
  const baseUrl = args.find((a) => !a.startsWith("--"));

  if (!baseUrl) {
    console.error("Usage: pnpm set-webhook <base-url> [--prod]");
    console.error("Example: pnpm set-webhook https://xxx.trycloudflare.com");
    console.error(
      "  Prod: pnpm set-webhook https://switch-operator.xxx.workers.dev --prod"
    );
    process.exit(1);
  }

  const varsFile = isProd ? ".prod.vars" : ".dev.vars";
  const varsPath = resolve(import.meta.dirname, `../${varsFile}`);

  let vars: Record<string, string>;
  try {
    vars = parseVarsFile(varsPath);
  } catch {
    console.error(`Could not read ${varsFile}. Create it with:`);
    console.error("  TELEGRAM_BOT_TOKEN=<token>");
    console.error("  TELEGRAM_WEBHOOK_SECRET=<secret>");
    process.exit(1);
  }

  const token = vars["TELEGRAM_BOT_TOKEN"];
  const secret = vars["TELEGRAM_WEBHOOK_SECRET"];

  if (!token || !secret) {
    console.error(
      `Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in ${varsFile}`
    );
    process.exit(1);
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/webhook/telegram`;

  console.log(`[${isProd ? "PROD" : "DEV"}] Setting webhook to: ${webhookUrl}`);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
    }
  );

  const result = (await response.json()) as { ok: boolean; description?: string };
  console.log("Response:", JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("Webhook registration failed:", result.description);
    process.exit(1);
  }
};

main();
