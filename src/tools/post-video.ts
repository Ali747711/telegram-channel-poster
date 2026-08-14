import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';

const inputSchema = {
  video_url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'video_url must be an http(s) URL'
    })
    .describe(
      'Publicly reachable video URL (MP4 recommended, ≤20MB — Telegram downloads it server-side).'
    ),
  caption: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Optional caption under the video, max 1024 chars. Same formatting rules as post text.'),
  parse_mode: z
    .enum(['HTML', 'MarkdownV2', 'none'])
    .default('HTML')
    .describe('Formatting mode for the caption. Prefer HTML.'),
  silent: z
    .boolean()
    .default(false)
    .describe('Post without sending subscribers a notification (default false).')
};

export function registerPostVideo(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_video',
    {
      title: 'Post a video to Telegram channel',
      description:
        `Publish a video (by public URL, ≤20MB) with an optional caption to the configured ` +
        `Telegram channel (${deps.channelId}). Returns the message ID and a public link.`,
      inputSchema
    },
    async ({ video_url, caption, parse_mode, silent }) => {
      try {
        const { sent, usedFallback } = await sendWithParseFallback(
          (parseMode) =>
            deps.telegram.sendVideo({
              chatId: deps.channelId,
              videoUrl: video_url,
              caption,
              parseMode,
              silent
            }),
          toParseMode(parse_mode)
        );
        deps.registry.record({
          messageId: sent.messageId,
          kind: 'video',
          content: caption ?? '(video)',
          link: sent.link
        });
        deps.logger.info('post_video succeeded', { messageId: sent.messageId });
        const link = sent.link !== undefined ? ` Link: ${sent.link}` : '';
        const fallbackNote = usedFallback
          ? ' Note: the caption formatting could not be parsed, so it was posted as plain text.'
          : '';
        return toolText(`Posted video to ${deps.channelId}: message_id ${sent.messageId}.${link}${fallbackNote}`);
      } catch (error) {
        deps.logger.error('post_video failed', { message: errorMessage(error) });
        return toolError(`Failed to post video to ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
