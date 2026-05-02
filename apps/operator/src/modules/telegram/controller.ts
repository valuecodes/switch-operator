import type { Logger } from "@repo/logger";
import type { Context } from "hono";

import { buildInitialMessages, OpenAiService } from "../../services/openai";
import type {
  ToolExecutor,
  ToolLoopMessages,
  ToolLoopOutcome,
  ToolResult,
} from "../../services/openai";
import { PendingActionService } from "../../services/pending-action";
import type { PendingAction } from "../../services/pending-action";
import { PendingConversationService } from "../../services/pending-conversation";
import type { QuestionOption } from "../../services/pending-conversation";
import {
  createScheduleSchema,
  MAX_ACTIVE_SCHEDULES,
  ScheduleService,
} from "../../services/schedule";
import type { CreateScheduleInput } from "../../services/schedule";
import { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import type {
  InlineKeyboardMarkup,
  TelegramCallbackQuery,
  TelegramUpdate,
} from "../../types/telegram";
import { markdownToTelegramHtml } from "../../utils/markdown-to-html";
import {
  splitMessage,
  TELEGRAM_HTML_SAFE_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "../../utils/message";
import { validateSourceUrl } from "@repo/url-validator";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const QUESTION_BUTTON_LABEL_MAX = 32;

const formatScheduleDescription = (
  type: string,
  args: Record<string, unknown>
): string => {
  const schedType =
    typeof args.schedule_type === "string" ? args.schedule_type : type;
  const parts: string[] = [`${schedType} schedule`];
  if (args.hour != null) {
    const h = typeof args.hour === "number" ? String(args.hour) : "0";
    const m =
      typeof args.minute === "number"
        ? String(args.minute).padStart(2, "0")
        : "00";
    parts.push(`at ${h}:${m}`);
  }
  if (typeof args.day_of_week === "number") {
    parts.push(`on ${DAYS[args.day_of_week] ?? "?"}`);
  }
  if (typeof args.day_of_month === "number") {
    parts.push(`on day ${String(args.day_of_month)}`);
  }
  const tz = typeof args.timezone === "string" ? args.timezone : "UTC";
  parts.push(`(${tz})`);
  if (args.use_browser === true) {
    parts.push("(browser rendering)");
  }
  if (typeof args.description === "string") {
    parts.push(`— "${args.description}"`);
  }
  return parts.join(" ");
};

const mapToolArgsToInput = (
  args: Record<string, unknown>
): CreateScheduleInput => ({
  scheduleType: args.schedule_type as CreateScheduleInput["scheduleType"],
  hour: args.hour as number | undefined,
  minute: args.minute as number | undefined,
  dayOfWeek: args.day_of_week as number | undefined,
  dayOfMonth: args.day_of_month as number | undefined,
  timezone: (args.timezone as string | undefined) ?? "Europe/Helsinki",
  fixedMessage: args.fixed_message as string | undefined,
  messagePrompt: args.message_prompt as string | undefined,
  sourceUrl: args.source_url as string | undefined,
  keywords: args.keywords as string[] | undefined,
  useBrowser: args.use_browser as boolean | undefined,
  description: (args.description as string | undefined) ?? "",
});

const buildConfirmationKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "✅ Yes", callback_data: `c:${token}` },
      { text: "❌ No", callback_data: `x:${token}` },
    ],
  ],
});

const truncateLabel = (label: string, max: number): string =>
  label.length <= max ? label : `${label.slice(0, max - 1)}…`;

const buildQuestionKeyboard = (
  token: string,
  options: QuestionOption[]
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    options.map((opt, idx) => ({
      text: truncateLabel(opt.label, QUESTION_BUTTON_LABEL_MAX),
      callback_data: `q:${token}:${String(idx)}`,
    })),
  ],
});

const executePendingAction = async (
  action: PendingAction,
  chatId: number,
  db: D1Database,
  logger: Logger
): Promise<string> => {
  const scheduleService = new ScheduleService(db);

  if (action.type === "create_schedule") {
    const input = action.payload as unknown as CreateScheduleInput;
    const row = await scheduleService.create(chatId, input);
    logger.info("schedule created", { scheduleId: row.id });
    return `Schedule created: ${action.description}\nID: ${row.id}\nNext run: ${row.nextRunAt}`;
  }

  // delete_schedule
  const id = action.payload.id as string;
  const deleted = await scheduleService.remove(id, chatId);
  if (deleted) {
    logger.info("schedule deleted", { scheduleId: id });
    return `Schedule ${id} has been deleted.`;
  }
  return `Schedule ${id} not found or already deleted.`;
};

type ToolExecutionContext = {
  pendingButtonToken: string | undefined;
};

const buildScheduleToolExecutor = (
  ctx: ToolExecutionContext,
  chatId: number,
  scheduleService: ScheduleService,
  pendingService: PendingActionService,
  logger: Logger
): ToolExecutor => {
  return async (name, args): Promise<ToolResult> => {
    logger.debug("tool call received", { tool: name });

    if (name === "list_schedules") {
      const list = await scheduleService.list(chatId);
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
      const count = await scheduleService.countActive(chatId);
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

      ctx.pendingButtonToken = await pendingService.set(chatId, {
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

      ctx.pendingButtonToken = await pendingService.set(chatId, {
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
};

const dispatchOutcome = async (
  outcome: ToolLoopOutcome,
  chatId: number,
  telegram: TelegramService,
  conversationService: PendingConversationService,
  pendingButtonToken: string | undefined
): Promise<void> => {
  if (outcome.kind === "ask_user_question") {
    const questionToken = await conversationService.set(chatId, {
      messages: outcome.messages,
      pendingToolCallId: outcome.toolCallId,
      options: outcome.options,
    });

    try {
      const replyMarkup = buildQuestionKeyboard(questionToken, outcome.options);
      const chunks = [
        ...splitMessage(outcome.question, TELEGRAM_MAX_MESSAGE_LENGTH),
      ];
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await telegram.sendMessage({
          chat_id: chatId,
          text: chunks[i],
          ...(isLast ? { reply_markup: replyMarkup } : {}),
        });
      }
    } catch (error) {
      await conversationService.clear(chatId);
      throw error;
    }
    return;
  }

  const replyMarkup = pendingButtonToken
    ? buildConfirmationKeyboard(pendingButtonToken)
    : undefined;
  const chunks = [...splitMessage(outcome.content, TELEGRAM_HTML_SAFE_LENGTH)];
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await telegram.sendMessage({
      chat_id: chatId,
      text: markdownToTelegramHtml(chunks[i]),
      parse_mode: "HTML" as const,
      ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
};

type WebhookInput = {
  in: { json: TelegramUpdate };
  out: { json: TelegramUpdate };
};

const handleWebhook = async (c: Context<AppEnv, string, WebhookInput>) => {
  const update = c.req.valid("json");
  if (update.callback_query) {
    return handleCallbackQuery(c, update.callback_query);
  }
  return handleMessage(c, update);
};

const handleMessage = async (
  c: Context<AppEnv, string, WebhookInput>,
  update: TelegramUpdate
) => {
  const logger = c.get("logger");
  const message = update.message;
  const isAllowedChat =
    message !== undefined && String(message.chat.id) === c.env.ALLOWED_CHAT_ID;

  logger.debug("incoming update", {
    updateId: update.update_id,
    hasMessage: message !== undefined,
    hasText: message?.text !== undefined,
  });
  logger.debug("chat authorization check", {
    updateId: update.update_id,
    isAllowedChat,
  });

  if (!message?.text) {
    return c.json({ ok: true });
  }

  if (!isAllowedChat) {
    logger.warn("chat not allowed, ignoring", { updateId: update.update_id });
    return c.json({ ok: true });
  }

  const chatId = message.chat.id;
  logger.info("message received from allowed chat", {
    updateId: update.update_id,
    textLength: message.text.length,
  });
  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN, logger);
  const pendingService = new PendingActionService(c.env.DB);
  const conversationService = new PendingConversationService(c.env.DB);

  // Typed-YES fallback path. Atomically claim any non-expired pending row
  // so a concurrent button tap can't also execute it.
  const consumed = await pendingService.consumeByChatId(chatId);
  if (consumed) {
    const confirmed = message.text.trim().toUpperCase() === "YES";

    if (confirmed) {
      const result = await executePendingAction(
        consumed,
        chatId,
        c.env.DB,
        logger
      );
      for (const chunk of splitMessage(result)) {
        await telegram.sendMessage({ chat_id: chatId, text: chunk });
      }
      return c.json({ ok: true });
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text: "Action cancelled.",
    });
    const isSimpleResponse =
      message.text.trim().length <= 3 ||
      message.text.trim().toUpperCase() === "NO";
    if (isSimpleResponse) {
      return c.json({ ok: true });
    }
  }

  // Any new typed message starts a fresh conversation — discard a stale
  // pending question so the user can change direction by typing.
  await conversationService.clear(chatId);

  const scheduleService = new ScheduleService(c.env.DB);
  const ctx: ToolExecutionContext = { pendingButtonToken: undefined };
  const toolExecutor = buildScheduleToolExecutor(
    ctx,
    chatId,
    scheduleService,
    pendingService,
    logger
  );

  let outcome: ToolLoopOutcome | undefined;
  try {
    const openai = new OpenAiService(c.env.OPENAI_API_KEY, logger);
    outcome = await openai.runToolLoop(
      buildInitialMessages(message.text),
      toolExecutor
    );
  } catch (error) {
    logger.error("openai request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await pendingService.clear(chatId);
    await conversationService.clear(chatId);
    await telegram.sendMessage({
      chat_id: chatId,
      text: "Something went wrong while generating a response. Please try again.",
    });
    return c.json({ ok: true });
  }

  try {
    await dispatchOutcome(
      outcome,
      chatId,
      telegram,
      conversationService,
      ctx.pendingButtonToken
    );
  } catch (error) {
    await pendingService.clear(chatId);
    throw error;
  }

  return c.json({ ok: true });
};

type ParsedCallback =
  | { action: "confirm" | "cancel"; token: string }
  | { action: "answer"; token: string; optionIndex: number };

const parseCallbackData = (
  data: string | undefined
): ParsedCallback | undefined => {
  if (!data) {
    return undefined;
  }
  if (data.startsWith("q:")) {
    const rest = data.slice(2);
    const colon = rest.indexOf(":");
    if (colon === -1) {
      return undefined;
    }
    const token = rest.slice(0, colon);
    const indexStr = rest.slice(colon + 1);
    if (!token || !/^\d+$/.test(indexStr)) {
      return undefined;
    }
    const optionIndex = Number.parseInt(indexStr, 10);
    return { action: "answer", token, optionIndex };
  }
  const colon = data.indexOf(":");
  if (colon === -1) {
    return undefined;
  }
  const prefix = data.slice(0, colon);
  const token = data.slice(colon + 1);
  if (!token) {
    return undefined;
  }
  if (prefix === "c") {
    return { action: "confirm", token };
  }
  if (prefix === "x") {
    return { action: "cancel", token };
  }
  return undefined;
};

const handleAnswerCallback = async (
  c: Context<AppEnv, string, WebhookInput>,
  cq: TelegramCallbackQuery,
  parsed: { action: "answer"; token: string; optionIndex: number },
  chatId: number,
  messageId: number | undefined,
  telegram: TelegramService,
  logger: Logger
): Promise<void> => {
  const conversationService = new PendingConversationService(c.env.DB);
  const pendingService = new PendingActionService(c.env.DB);

  const consumed = await conversationService.consumeByToken(
    chatId,
    parsed.token
  );

  const ackAndClear = async (toast: string): Promise<void> => {
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id, text: toast })
      .catch((err: unknown) => {
        logger.warn("answerCallbackQuery failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    if (messageId !== undefined) {
      await telegram
        .editMessageReplyMarkup({ chat_id: chatId, message_id: messageId })
        .catch((err: unknown) => {
          logger.warn("editMessageReplyMarkup failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  };

  if (!consumed) {
    await ackAndClear("Expired or already used");
    return;
  }

  if (parsed.optionIndex < 0 || parsed.optionIndex >= consumed.options.length) {
    logger.warn("answer callback option index out of range", {
      callbackId: cq.id,
      optionIndex: parsed.optionIndex,
      optionsLength: consumed.options.length,
    });
    await ackAndClear("Invalid option");
    return;
  }

  const chosen = consumed.options[parsed.optionIndex];
  const messages: ToolLoopMessages = [
    ...(consumed.messages as ToolLoopMessages),
    {
      role: "tool",
      tool_call_id: consumed.pendingToolCallId,
      content: JSON.stringify({ value: chosen.value, label: chosen.label }),
    },
  ];

  // Ack the click immediately so the user's button stops spinning while we
  // call OpenAI; clear the inline keyboard from the question message.
  await ackAndClear("Recorded");

  const scheduleService = new ScheduleService(c.env.DB);
  const ctx: ToolExecutionContext = { pendingButtonToken: undefined };
  const toolExecutor = buildScheduleToolExecutor(
    ctx,
    chatId,
    scheduleService,
    pendingService,
    logger
  );

  let outcome: ToolLoopOutcome | undefined;
  try {
    const openai = new OpenAiService(c.env.OPENAI_API_KEY, logger);
    outcome = await openai.runToolLoop(messages, toolExecutor);
  } catch (error) {
    logger.error("openai resume failed", {
      callbackId: cq.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await pendingService.clear(chatId);
    await conversationService.clear(chatId);
    await telegram.sendMessage({
      chat_id: chatId,
      text: "Something went wrong while continuing the conversation. Please try again.",
    });
    return;
  }

  try {
    await dispatchOutcome(
      outcome,
      chatId,
      telegram,
      conversationService,
      ctx.pendingButtonToken
    );
  } catch (error) {
    logger.error("dispatch resumed outcome failed", {
      callbackId: cq.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await pendingService.clear(chatId);
  }
};

const handleCallbackQuery = async (
  c: Context<AppEnv, string, WebhookInput>,
  cq: TelegramCallbackQuery
) => {
  const logger = c.get("logger");
  const allowedChatId = c.env.ALLOWED_CHAT_ID;
  const fromAllowed = String(cq.from.id) === allowedChatId;

  if (!fromAllowed) {
    logger.warn("callback_query not allowed, ignoring", {
      callbackId: cq.id,
    });
    return c.json({ ok: true });
  }

  const cqChatId = cq.message?.chat.id;
  if (cqChatId !== undefined && String(cqChatId) !== allowedChatId) {
    logger.warn("callback_query not allowed, ignoring", {
      callbackId: cq.id,
    });
    return c.json({ ok: true });
  }

  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN, logger);
  const messageId = cq.message?.message_id;
  const chatId = cq.message?.chat.id;

  if (chatId === undefined) {
    // Inaccessible message stub — no chat to act on. Ack and stop.
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id })
      .catch(() => undefined);
    return c.json({ ok: true });
  }

  const parsed = parseCallbackData(cq.data);
  if (!parsed) {
    logger.warn("callback_query has malformed data", { callbackId: cq.id });
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id, text: "Malformed" })
      .catch(() => undefined);
    return c.json({ ok: true });
  }

  if (parsed.action === "answer") {
    await handleAnswerCallback(
      c,
      cq,
      parsed,
      chatId,
      messageId,
      telegram,
      logger
    );
    return c.json({ ok: true });
  }

  const pendingService = new PendingActionService(c.env.DB);

  let toast: string | undefined;
  let resultMessage: string | undefined;
  try {
    const consumed = await pendingService.consumeByToken(chatId, parsed.token);
    if (!consumed) {
      toast = "Expired or already used";
    } else if (parsed.action === "cancel") {
      toast = "Cancelled";
    } else {
      resultMessage = await executePendingAction(
        consumed,
        chatId,
        c.env.DB,
        logger
      );
      toast =
        consumed.type === "create_schedule"
          ? "Schedule created"
          : "Schedule deleted";
    }
  } catch (error) {
    logger.error("callback execution failed", {
      callbackId: cq.id,
      error: error instanceof Error ? error.message : String(error),
    });
    toast = "Something went wrong";
  } finally {
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id, text: toast })
      .catch((err: unknown) => {
        logger.warn("answerCallbackQuery failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    if (messageId !== undefined) {
      await telegram
        .editMessageReplyMarkup({ chat_id: chatId, message_id: messageId })
        .catch((err: unknown) => {
          logger.warn("editMessageReplyMarkup failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  if (resultMessage) {
    for (const chunk of splitMessage(resultMessage)) {
      await telegram.sendMessage({ chat_id: chatId, text: chunk });
    }
  }

  return c.json({ ok: true });
};

export { handleWebhook, parseCallbackData };
