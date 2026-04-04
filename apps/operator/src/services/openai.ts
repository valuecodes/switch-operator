import type { Logger } from "@repo/logger";
import OpenAI from "openai";

const SYSTEM_PROMPT =
  "You are a helpful personal assistant called Switch Operator. Be concise and helpful.";

class OpenAiService {
  private readonly client: OpenAI;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 0 });
    this.logger = logger;
  }

  async reply(userMessage: string): Promise<string> {
    this.logger.debug("sending chat completion request", {
      messageLength: userMessage.length,
    });

    const response = await this.client.chat.completions.create({
      model: "gpt-5.4-mini",
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    this.logger.debug("chat completion received", {
      responseLength: content.length,
    });

    return content;
  }
}

export { OpenAiService };
