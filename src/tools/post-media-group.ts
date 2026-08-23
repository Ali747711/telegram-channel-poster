import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

const itemSchema = z.object({
  type: z.enum(['photo', 'video']),
  url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'media URLs must be http(s)'
    })
    .describe('Publicly reachable media URL.'),
  caption: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Optional caption. Put it on the FIRST item to caption the whole album.')
});

const inputSchema = {
  items: z.array(itemSchema).min(2).max(10).describe('2–10 photos/videos posted as one album.'),
  parse_mode: z.enum(['HTML', 'MarkdownV2', 'none']).default('HTML'),
  silent: z.boolean().default(false).describe('Post without notifying subscribers.')
};

export function registerPostMediaGroup(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_media_group',
    {
      title: 'Post an album to Telegram channel',
      description:
        `Publish 2–10 photos/videos as a single album post in ${deps.channelId} (public URLs only — ` +
        'for a single local file use post_photo/post_video with a file_id). Returns all message IDs.',
      inputSchema
    },
    async ({ items, parse_mode, silent }) => {
      try {
        const sent = await deps.telegram.sendMediaGroup({
          chatId: deps.channelId,
          items: items.map((item) => ({
            type: item.type,
            url: item.url,
            caption: item.caption,
            ...(item.caption !== undefined && parse_mode !== 'none' ? { parseMode: parse_mode } : {})
          })),
          silent
        });
        const first = sent[0];
        if (first !== undefined) {
          await deps.registry.record({
            messageId: first.messageId,
            kind: 'album',
            content: items[0]?.caption ?? `(album of ${items.length})`,
            link: first.link
          });
        }
        deps.logger.info('post_media_group succeeded', { messageIds: sent.map((s) => s.messageId) });
        const ids = sent.map((s) => s.messageId).join(', ');
        const link = first?.link !== undefined ? ` Link: ${first.link}` : '';
        return toolText(`Posted album (${sent.length} items) to ${deps.channelId}: message_ids ${ids}.${link}`);
      } catch (error) {
        deps.logger.error('post_media_group failed', { message: errorMessage(error) });
        return toolError(`Failed to post album to ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
