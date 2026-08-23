import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';
import { resolveMediaSource } from './media-source.js';

const inputSchema = {
  photo_url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'photo_url must be an http(s) URL'
    })
    .optional()
    .describe(
      'Publicly reachable image URL (JPEG/PNG/GIF/WebP, up to ~5MB — Telegram fetches it server-side).'
    ),
  file_id: z
    .string()
    .optional()
    .describe('Alternative to photo_url: id of a file uploaded via POST /upload (for local images).'),
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
        `Publish a photo with an optional caption to the configured Telegram channel ` +
        `(${deps.channelId}) — by public URL, or by file_id from POST /upload for local images. ` +
        'Returns the message ID and a public link.',
      inputSchema
    },
    async ({ photo_url, file_id, caption, parse_mode, silent }) => {
      const source = resolveMediaSource(deps, photo_url, file_id);
      if (source.error !== undefined) {
        return toolError(source.error);
      }
      try {
        const { sent, usedFallback } = await sendWithParseFallback(
          (parseMode) =>
            deps.telegram.sendPhoto({
              chatId: deps.channelId,
              photoUrl: source.url,
              photoFile: source.file,
              caption,
              parseMode,
              silent
            }),
          toParseMode(parse_mode)
        );
        await deps.registry.record({
          messageId: sent.messageId,
          kind: 'photo',
          content: caption ?? source.file?.filename ?? '(photo)',
          link: sent.link
        });
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
