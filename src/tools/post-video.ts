import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';
import { resolveMediaSource } from './media-source.js';

const inputSchema = {
  video_url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'video_url must be an http(s) URL'
    })
    .optional()
    .describe(
      'Publicly reachable video URL (MP4 recommended, ≤20MB — Telegram downloads it server-side).'
    ),
  file_id: z
    .string()
    .optional()
    .describe('Alternative to video_url: id of a file uploaded via POST /upload (for local videos).'),
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
        `Publish a video with an optional caption to the configured Telegram channel ` +
        `(${deps.channelId}) — by public URL (≤20MB), or by file_id from POST /upload for local videos. ` +
        'Returns the message ID and a public link.',
      inputSchema
    },
    async ({ video_url, file_id, caption, parse_mode, silent }) => {
      const source = resolveMediaSource(deps, video_url, file_id);
      if (source.error !== undefined) {
        return toolError(source.error);
      }
      try {
        const { sent, usedFallback } = await sendWithParseFallback(
          (parseMode) =>
            deps.telegram.sendVideo({
              chatId: deps.channelId,
              videoUrl: source.url,
              videoFile: source.file,
              caption,
              parseMode,
              silent
            }),
          toParseMode(parse_mode)
        );
        await deps.registry.record({
          messageId: sent.messageId,
          kind: 'video',
          content: caption ?? source.file?.filename ?? '(video)',
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
