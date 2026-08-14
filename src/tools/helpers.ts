import { TelegramApiError, type ParseMode, type SentMessage } from '../telegram/client.js';

export type ParseModeInput = 'HTML' | 'MarkdownV2' | 'none';

export interface ToolResult {
  // Index signature required for structural compatibility with the SDK's CallToolResult.
  readonly [key: string]: unknown;
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
}

export const toolText = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

export const toolError = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true
});

export const toParseMode = (mode: ParseModeInput): ParseMode | undefined =>
  mode === 'none' ? undefined : mode;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isParseEntityError = (error: unknown): boolean =>
  error instanceof TelegramApiError &&
  error.errorCode === 400 &&
  /parse entities/i.test(error.message);

/**
 * Runs a send once with the requested parse mode; if Telegram rejects the
 * formatting entities (400 "can't parse entities"), retries once as plain text
 * so a formatting mistake never blocks a post.
 */
export async function sendWithParseFallback(
  send: (parseMode?: ParseMode) => Promise<SentMessage>,
  parseMode?: ParseMode
): Promise<{ sent: SentMessage; usedFallback: boolean }> {
  try {
    return { sent: await send(parseMode), usedFallback: false };
  } catch (error) {
    if (parseMode !== undefined && isParseEntityError(error)) {
      return { sent: await send(undefined), usedFallback: true };
    }
    throw error;
  }
}
