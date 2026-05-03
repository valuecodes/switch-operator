import type { Logger } from "@repo/logger";
import { validateSourceUrl } from "@repo/url-validator";

import { buildInitialMessages, OpenAiService } from "../../services/openai";
import type {
  ToolExecutor,
  ToolLoopMessages,
  ToolLoopOutcome,
  ToolResult,
} from "../../services/openai";
import { PendingActionService } from "../../services/pending-action";
import { PendingConversationService } from "../../services/pending-conversation";
import type { QuestionOption } from "../../services/pending-conversation";
import {
  createScheduleSchema,
  MAX_ACTIVE_SCHEDULES,
  ScheduleService,
} from "../../services/schedule";
import type { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import { markdownToTelegramHtml } from "../../utils/markdown-to-html";
import {
  splitMessage,
  TELEGRAM_HTML_SAFE_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "../../utils/message";
import {
  buildConfirmationKeyboard,
  buildQuestionKeyboard,
  formatScheduleDescription,
  mapToolArgsToInput,
} from "./ui";

class ConversationRunner {
  private readonly env: AppEnv["Bindings"];
  private readonly logger: Logger;
  private readonly chatId: number;
  private readonly telegram: TelegramService;
  private readonly pendingActions: PendingActionService;
  private readonly pendingConversations: PendingConversationService;
  private pendingButtonToken: string | undefined;

  constructor(
    chatId: number,
    env: AppEnv["Bindings"],
    logger: Logger,
    telegram: TelegramService
  ) {
    this.chatId = chatId;
    this.env = env;
    this.logger = logger;
    this.telegram = telegram;
    this.pendingActions = new PendingActionService(env.DB);
    this.pendingConversations = new PendingConversationService(env.DB);
  }

  async startFromMessage(userMessage: string): Promise<void> {
    // Any new typed message starts a fresh conversation — discard a stale
    // pending question so the user can change direction by typing.
    await this.pendingConversations.clear(this.chatId);
    await this.runLoop(buildInitialMessages(userMessage));
  }

  async resumeFromAnswer(
    priorMessages: ToolLoopMessages,
    pendingToolCallId: string,
    chosen: QuestionOption
  ): Promise<void> {
    const messages: ToolLoopMessages = [
      ...priorMessages,
      {
        role: "tool",
        tool_call_id: pendingToolCallId,
        content: JSON.stringify({ value: chosen.value, label: chosen.label }),
      },
    ];
    await this.runLoop(messages);
  }

  private async runLoop(messages: ToolLoopMessages): Promise<void> {
    const scheduleService = new ScheduleService(this.env.DB);
    const toolExecutor = this.buildToolExecutor(scheduleService);

    let outcome: ToolLoopOutcome | undefined;
    try {
      const openai = new OpenAiService(this.env.OPENAI_API_KEY, this.logger);
      outcome = await openai.runToolLoop(messages, toolExecutor);
    } catch (error) {
      await this.handleLoopError(error);
      return;
    }

    try {
      await this.dispatchOutcome(outcome);
    } catch (error) {
      await this.pendingActions.clear(this.chatId);
      throw error;
    }
  }

  private buildToolExecutor(scheduleService: ScheduleService): ToolExecutor {
    return async (name, args): Promise<ToolResult> => {
      this.logger.debug("tool call received", { tool: name });

      if (name === "list_schedules") {
        const list = await scheduleService.list(this.chatId);
        return {
          result: JSON.stringify(
            list.map((s) => ({
              id: s.id,
              type: s.scheduleType,
              description: s.description,
              hour: s.hour,
              minute: s.minute,
              dayOfWeek: s.dayOfWeek,
              dayOfMonth: s.dayOfMonth,
              timezone: s.timezone,
              sourceUrl: s.sourceUrl,
              nextRunAt: s.nextRunAt,
            }))
          ),
        };
      }

      if (name === "create_schedule") {
        if (
          typeof args.source_url === "string" &&
          args.source_url.length > 0 &&
          args.use_browser === undefined
        ) {
          return {
            error:
              "Monitors require an explicit use_browser choice. Call ask_user_question first to ask the user whether this URL needs the browser scraper (JS rendering), then retry create_schedule with the chosen boolean.",
          };
        }

        const count = await scheduleService.countActive(this.chatId);
        if (count >= MAX_ACTIVE_SCHEDULES) {
          return {
            error: `Quota exceeded: maximum ${String(MAX_ACTIVE_SCHEDULES)} active schedules`,
          };
        }

        const input = mapToolArgsToInput(args);
        const validation = createScheduleSchema.safeParse(input);
        if (!validation.success) {
          return { error: validation.error.message };
        }

        if (input.sourceUrl) {
          const urlCheck = validateSourceUrl(input.sourceUrl);
          if (!urlCheck.valid) {
            return { error: urlCheck.reason };
          }
        }

        this.pendingButtonToken = await this.pendingActions.set(this.chatId, {
          type: "create_schedule",
          payload: input as unknown as Record<string, unknown>,
          description: formatScheduleDescription("create", args),
        });

        return {
          result: `Confirmation buttons attached. Reply with a short summary like 'Confirm creating: ${formatScheduleDescription("create", args)}' — do NOT ask the user to type YES.`,
        };
      }

      if (name === "delete_schedule") {
        const id = args.id as string | undefined;
        if (!id) {
          return { error: "Missing schedule ID" };
        }

        this.pendingButtonToken = await this.pendingActions.set(this.chatId, {
          type: "delete_schedule",
          payload: { id },
          description: `Delete schedule ${id}`,
        });

        return {
          result: `Confirmation buttons attached. Reply with a short summary like 'Confirm deleting schedule ${id}' — do NOT ask the user to type YES.`,
        };
      }

      return { error: `Unknown tool: ${name}` };
    };
  }

  private async dispatchOutcome(outcome: ToolLoopOutcome): Promise<void> {
    if (outcome.kind === "ask_user_question") {
      const questionToken = await this.pendingConversations.set(this.chatId, {
        messages: outcome.messages,
        pendingToolCallId: outcome.toolCallId,
        options: outcome.options,
      });

      try {
        const replyMarkup = buildQuestionKeyboard(
          questionToken,
          outcome.options
        );
        const chunks = [
          ...splitMessage(outcome.question, TELEGRAM_MAX_MESSAGE_LENGTH),
        ];
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await this.telegram.sendMessage({
            chat_id: this.chatId,
            text: chunks[i],
            ...(isLast ? { reply_markup: replyMarkup } : {}),
          });
        }
      } catch (error) {
        await this.pendingConversations.clear(this.chatId);
        throw error;
      }
      return;
    }

    const replyMarkup = this.pendingButtonToken
      ? buildConfirmationKeyboard(this.pendingButtonToken)
      : undefined;
    const chunks = [
      ...splitMessage(outcome.content, TELEGRAM_HTML_SAFE_LENGTH),
    ];
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await this.telegram.sendMessage({
        chat_id: this.chatId,
        text: markdownToTelegramHtml(chunks[i]),
        parse_mode: "HTML" as const,
        ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
  }

  private async handleLoopError(error: unknown): Promise<void> {
    this.logger.error("openai request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await this.pendingActions.clear(this.chatId);
    await this.pendingConversations.clear(this.chatId);
    await this.telegram.sendMessage({
      chat_id: this.chatId,
      text: "Something went wrong while generating a response. Please try again.",
    });
  }
}

export { ConversationRunner };
