const API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
/** Longest 429 retry_after we are willing to sleep through inside one MCP request. */
const MAX_RETRY_AFTER_S = 30;

export type ParseMode = 'HTML' | 'MarkdownV2';

export interface SendMessageParams {
  readonly chatId: string | number;
  readonly text: string;
  readonly parseMode?: ParseMode;
  readonly disableLinkPreview?: boolean;
  readonly silent?: boolean;
}

export interface SendPhotoParams {
  readonly chatId: string | number;
  readonly photoUrl: string;
  readonly caption?: string;
  readonly parseMode?: ParseMode;
  readonly silent?: boolean;
}

export interface SentMessage {
  readonly messageId: number;
  readonly link?: string;
}

export interface ChatInfo {
  readonly id: number;
  readonly title?: string;
  readonly username?: string;
  readonly type: string;
}

export interface EditTextParams {
  readonly chatId: string | number;
  readonly messageId: number;
  readonly text: string;
  readonly parseMode?: ParseMode;
  readonly disableLinkPreview?: boolean;
}

export interface EditCaptionParams {
  readonly chatId: string | number;
  readonly messageId: number;
  readonly caption: string;
  readonly parseMode?: ParseMode;
}

export interface SendVideoParams {
  readonly chatId: string | number;
  readonly videoUrl: string;
  readonly caption?: string;
  readonly parseMode?: ParseMode;
  readonly silent?: boolean;
}

export interface BotInfo {
  readonly id: number;
  readonly username: string;
}

export interface ChatMemberInfo {
  readonly status: string;
  readonly canPostMessages?: boolean;
}

export interface TelegramClient {
  readonly sendMessage: (params: SendMessageParams) => Promise<SentMessage>;
  readonly sendPhoto: (params: SendPhotoParams) => Promise<SentMessage>;
  readonly getChat: (chatId: string | number) => Promise<ChatInfo>;
  readonly getMe: () => Promise<BotInfo>;
  readonly getChatMember: (chatId: string | number, userId: number) => Promise<ChatMemberInfo>;
  readonly editMessageText: (params: EditTextParams) => Promise<SentMessage>;
  readonly editMessageCaption: (params: EditCaptionParams) => Promise<SentMessage>;
  readonly deleteMessage: (chatId: string | number, messageId: number) => Promise<boolean>;
  readonly sendVideo: (params: SendVideoParams) => Promise<SentMessage>;
}

export interface TelegramClientOptions {
  readonly botToken: string;
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export class TelegramApiError extends Error {
  readonly errorCode?: number;
  readonly retryAfter?: number;

  constructor(message: string, options?: { errorCode?: number; retryAfter?: number }) {
    super(message);
    this.name = 'TelegramApiError';
    this.errorCode = options?.errorCode;
    this.retryAfter = options?.retryAfter;
  }
}

interface ApiEnvelope {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: { readonly retry_after?: number };
}

interface RawMessage {
  readonly message_id: number;
  readonly chat: { readonly id: number; readonly username?: string };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toApiError = (method: string, envelope: ApiEnvelope, sanitize: (s: string) => string): TelegramApiError => {
  const code = envelope.error_code;
  const description = envelope.description ?? 'no description';

  if (code === 401) {
    return new TelegramApiError(
      'Telegram rejected the bot token (401 Unauthorized). Check TELEGRAM_BOT_TOKEN.',
      { errorCode: code }
    );
  }
  if (code === 403) {
    return new TelegramApiError(
      `Telegram refused the request (403): ${sanitize(description)}. ` +
        'Make sure the bot is an admin of the channel with the "Post Messages" permission.',
      { errorCode: code }
    );
  }
  if (code === 400 && description.toLowerCase().includes('chat not found')) {
    return new TelegramApiError(
      'Telegram says "chat not found" (400). Check TELEGRAM_CHANNEL_ID and make sure the bot was added to that channel.',
      { errorCode: code }
    );
  }
  if (code === 429) {
    const retryAfter = envelope.parameters?.retry_after ?? 1;
    return new TelegramApiError(`Telegram rate limit hit (429), retry after ${retryAfter}s.`, {
      errorCode: code,
      retryAfter
    });
  }
  return new TelegramApiError(
    `Telegram API ${method} failed (${code ?? 'unknown'}): ${sanitize(description)}`,
    { errorCode: code }
  );
};

const toSentMessage = (raw: RawMessage): SentMessage => ({
  messageId: raw.message_id,
  ...(raw.chat.username !== undefined
    ? { link: `https://t.me/${raw.chat.username}/${raw.message_id}` }
    : {})
});

type ApiCall = (method: string, payload: Record<string, unknown>) => Promise<unknown>;

interface RequestContext {
  readonly botToken: string;
  readonly fetchFn: typeof fetch;
  readonly sanitize: (text: string) => string;
}

const performRequest = async (
  ctx: RequestContext,
  method: string,
  payload: Record<string, unknown>
): Promise<unknown> => {
  let response: Response;
  try {
    response = await ctx.fetchFn(`${API_BASE}/bot${ctx.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TelegramApiError(`Telegram API is unreachable (${method}): ${ctx.sanitize(detail)}`);
  }

  let envelope: ApiEnvelope;
  try {
    envelope = (await response.json()) as ApiEnvelope;
  } catch {
    throw new TelegramApiError(
      `Telegram API returned a non-JSON response (${method}, HTTP ${response.status}).`
    );
  }

  if (envelope.ok && envelope.result !== undefined) {
    return envelope.result;
  }
  throw toApiError(method, envelope, ctx.sanitize);
};

const callWithOneRetry = async (
  runOnce: ApiCall,
  sleepFn: (ms: number) => Promise<void>,
  method: string,
  payload: Record<string, unknown>
): Promise<unknown> => {
  try {
    return await runOnce(method, payload);
  } catch (error) {
    if (!(error instanceof TelegramApiError) || error.errorCode !== 429) {
      throw error;
    }
    const retryAfter = error.retryAfter ?? 1;
    if (retryAfter > MAX_RETRY_AFTER_S) {
      throw new TelegramApiError(
        `Telegram rate limit hit (429): asked to wait ${retryAfter}s, which is too long for one request. Try again later.`,
        { errorCode: 429, retryAfter }
      );
    }
    await sleepFn(retryAfter * 1000);
    try {
      return await runOnce(method, payload);
    } catch (secondError) {
      if (secondError instanceof TelegramApiError && secondError.errorCode === 429) {
        throw new TelegramApiError(
          'Telegram rate limit hit (429) persisted after one retry. Try again in a minute.',
          { errorCode: 429 }
        );
      }
      throw secondError;
    }
  }
};

/**
 * Thin typed wrapper over the Telegram Bot API. Errors are mapped to
 * actionable messages, 429s are retried once (bounded by MAX_RETRY_AFTER_S),
 * and the bot token is scrubbed from every message that could reach a client.
 */
export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const { botToken, fetchFn = fetch, sleepFn = defaultSleep } = options;
  const sanitize = (text: string): string => text.split(botToken).join('[bot-token]');
  const runOnce: ApiCall = (method, payload) =>
    performRequest({ botToken, fetchFn, sanitize }, method, payload);
  const call: ApiCall = (method, payload) => callWithOneRetry(runOnce, sleepFn, method, payload);

  return Object.freeze({
    sendMessage: async (params: SendMessageParams): Promise<SentMessage> => {
      const raw = (await call('sendMessage', {
        chat_id: params.chatId,
        text: params.text,
        ...(params.parseMode !== undefined ? { parse_mode: params.parseMode } : {}),
        link_preview_options: { is_disabled: params.disableLinkPreview ?? true },
        disable_notification: params.silent ?? false
      })) as RawMessage;
      return toSentMessage(raw);
    },

    sendPhoto: async (params: SendPhotoParams): Promise<SentMessage> => {
      const raw = (await call('sendPhoto', {
        chat_id: params.chatId,
        photo: params.photoUrl,
        ...(params.caption !== undefined ? { caption: params.caption } : {}),
        ...(params.parseMode !== undefined ? { parse_mode: params.parseMode } : {}),
        disable_notification: params.silent ?? false
      })) as RawMessage;
      return toSentMessage(raw);
    },

    getChat: async (chatId: string | number): Promise<ChatInfo> => {
      const raw = (await call('getChat', { chat_id: chatId })) as {
        id: number;
        title?: string;
        username?: string;
        type: string;
      };
      return { id: raw.id, title: raw.title, username: raw.username, type: raw.type };
    },

    getMe: async (): Promise<BotInfo> => {
      const raw = (await call('getMe', {})) as { id: number; username: string };
      return { id: raw.id, username: raw.username };
    },

    editMessageText: async (params: EditTextParams): Promise<SentMessage> => {
      const raw = (await call('editMessageText', {
        chat_id: params.chatId,
        message_id: params.messageId,
        text: params.text,
        ...(params.parseMode !== undefined ? { parse_mode: params.parseMode } : {}),
        link_preview_options: { is_disabled: params.disableLinkPreview ?? true }
      })) as RawMessage;
      return toSentMessage(raw);
    },

    editMessageCaption: async (params: EditCaptionParams): Promise<SentMessage> => {
      const raw = (await call('editMessageCaption', {
        chat_id: params.chatId,
        message_id: params.messageId,
        caption: params.caption,
        ...(params.parseMode !== undefined ? { parse_mode: params.parseMode } : {})
      })) as RawMessage;
      return toSentMessage(raw);
    },

    deleteMessage: async (chatId: string | number, messageId: number): Promise<boolean> => {
      return (await call('deleteMessage', { chat_id: chatId, message_id: messageId })) === true;
    },

    sendVideo: async (params: SendVideoParams): Promise<SentMessage> => {
      const raw = (await call('sendVideo', {
        chat_id: params.chatId,
        video: params.videoUrl,
        ...(params.caption !== undefined ? { caption: params.caption } : {}),
        ...(params.parseMode !== undefined ? { parse_mode: params.parseMode } : {}),
        disable_notification: params.silent ?? false,
        supports_streaming: true
      })) as RawMessage;
      return toSentMessage(raw);
    },

    getChatMember: async (chatId: string | number, userId: number): Promise<ChatMemberInfo> => {
      const raw = (await call('getChatMember', { chat_id: chatId, user_id: userId })) as {
        status: string;
        can_post_messages?: boolean;
      };
      return {
        status: raw.status,
        ...(raw.can_post_messages !== undefined ? { canPostMessages: raw.can_post_messages } : {})
      };
    }
  });
}
