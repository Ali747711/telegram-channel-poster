import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { TelegramApiError, type SentMessage } from '../telegram/client.js';
import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';

const inputSchema = {
  message_id: z
    .number()
    .int()
    .positive()
    .describe('ID of the post to edit — from a posting result or list_recent_posts.'),
  text: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      'Replacement content. For photo/video posts this becomes the new caption (≤1024 chars). Same HTML rules as posting.'
    ),
  parse_mode: z
    .enum(['HTML', 'MarkdownV2', 'none'])
    .default('HTML')
    .describe('Formatting mode. Prefer HTML.')
};

const isMediaMessageError = (error: unknown): boolean =>
  error instanceof TelegramApiError &&
  error.errorCode === 400 &&
  /no text in the message/i.test(error.message);

export function registerEditPost(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'edit_post',
    {
      title: 'Edit a channel post',
      description:
        `Replace the text of a post in ${deps.channelId} (or the caption, for photo/video posts — ` +
        'detected automatically). Only posts made by this bot can be edited.',
      inputSchema
    },
    async ({ message_id, text, parse_mode }) => {
      const parseMode = toParseMode(parse_mode);
      try {
        let sent: SentMessage;
        let viaCaption = false;
        try {
          ({ sent } = await sendWithParseFallback(
            (mode) =>
              deps.telegram.editMessageText({
                chatId: deps.channelId,
                messageId: message_id,
                text,
                parseMode: mode
              }),
            parseMode
          ));
        } catch (error) {
          if (!isMediaMessageError(error)) {
            throw error;
          }
          ({ sent } = await sendWithParseFallback(
            (mode) =>
              deps.telegram.editMessageCaption({
                chatId: deps.channelId,
                messageId: message_id,
                caption: text,
                parseMode: mode
              }),
            parseMode
          ));
          viaCaption = true;
        }

        await deps.registry.markEdited(message_id, text);
        deps.logger.info('edit_post succeeded', { messageId: message_id, viaCaption });
        const link = sent.link !== undefined ? ` Link: ${sent.link}` : '';
        return toolText(
          `Edited ${viaCaption ? 'the caption of ' : ''}message_id ${message_id}.${link}`
        );
      } catch (error) {
        deps.logger.error('edit_post failed', { messageId: message_id, message: errorMessage(error) });
        return toolError(`Failed to edit message_id ${message_id}: ${errorMessage(error)}`);
      }
    }
  );
}
