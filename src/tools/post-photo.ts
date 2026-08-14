import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';

const inputSchema = {
  photo_url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'photo_url must be an http(s) URL'
    })
    .describe(
      'Publicly reachable image URL (JPEG/PNG/GIF/WebP, up to ~5MB). ' +
        'Telegram downloads it server-side; data: URIs and local paths do not work.'
    ),
  caption: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Optional caption under the photo, max 1024 chars. Same formatting rules as post text.'),
  parse_mode: z
    .enum(['HTML', 'MarkdownV2', 'none'])
    .default('HTML')
    .describe('Formatting mode for the caption. Prefer HTML.'),
  silent: z
    .boolean()
    .default(false)
    .describe('Post without sending subscribers a notification (default false).')
};

export function registerPostPhoto(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_photo',
    {
      title: 'Post a photo to Telegram channel',
      description:
        `Publish a photo (by public URL) with an optional caption to the configured ` +
        `Telegram channel (${deps.channelId}). Returns the message ID and a public link.`,
      inputSchema
    },
    async ({ photo_url, caption, parse_mode, silent }) => {
      try {
        const { sent, usedFallback } = await sendWithParseFallback(
          (parseMode) =>
            deps.telegram.sendPhoto({
              chatId: deps.channelId,
              photoUrl: photo_url,
              caption,
              parseMode,
              silent
            }),
          toParseMode(parse_mode)
        );
        deps.logger.info('post_photo succeeded', { messageId: sent.messageId });
        const link = sent.link !== undefined ? ` Link: ${sent.link}` : '';
        const fallbackNote = usedFallback
          ? ' Note: the caption formatting could not be parsed, so it was posted as plain text.'
          : '';
        return toolText(`Posted photo to ${deps.channelId}: message_id ${sent.messageId}.${link}${fallbackNote}`);
      } catch (error) {
        deps.logger.error('post_photo failed', { message: errorMessage(error) });
        return toolError(`Failed to post photo to ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
