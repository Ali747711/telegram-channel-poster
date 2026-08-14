import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SentMessage } from '../telegram/client.js';
import { splitMessage } from '../telegram/split-message.js';
import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';

const inputSchema = {
  text: z
    .string()
    .min(1)
    .max(40_000)
    .describe(
      'Post content. With the default HTML mode you can use <b>bold</b>, <i>italic</i>, ' +
        '<a href="https://...">links</a> and <code>code</code>. Text longer than 4096 chars ' +
        'is split into sequential posts at paragraph boundaries.'
    ),
  parse_mode: z
    .enum(['HTML', 'MarkdownV2', 'none'])
    .default('HTML')
    .describe(
      'Formatting mode. Prefer HTML — MarkdownV2 requires escaping 18 special characters ' +
        'and fails easily. Use "none" for plain text.'
    ),
  disable_link_preview: z
    .boolean()
    .default(true)
    .describe('Hide the link-preview card under the post (default true).'),
  silent: z
    .boolean()
    .default(false)
    .describe('Post without sending subscribers a notification (default false).')
};

const summarize = (channelId: string, posted: readonly SentMessage[], usedFallback: boolean): string => {
  const ids = posted.map((p) => p.messageId).join(', ');
  const countNote =
    posted.length > 1 ? `${posted.length} messages (split for length), message_ids ${ids}` : `message_id ${ids}`;
  const link = posted[0]?.link !== undefined ? ` Link: ${posted[0].link}` : '';
  const fallbackNote = usedFallback
    ? ' Note: the requested formatting could not be parsed, so it was posted as plain text.'
    : '';
  return `Posted to ${channelId}: ${countNote}.${link}${fallbackNote}`;
};

export function registerPostToChannel(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_to_channel',
    {
      title: 'Post to Telegram channel',
      description:
        `Publish a text post to the configured Telegram channel (${deps.channelId}). ` +
        'Returns the message ID(s) and a public link. If the formatting cannot be parsed, ' +
        'the post is retried once as plain text.',
      inputSchema
    },
    async ({ text, parse_mode, disable_link_preview, silent }) => {
      const chunks = splitMessage(text).filter((chunk) => chunk.trim().length > 0);
      const posted: SentMessage[] = [];
      let usedFallback = false;
      // Once one chunk falls back to plain text, send the rest plain directly
      // so the post stays consistently formatted and we skip doomed retries.
      let activeParseMode = toParseMode(parse_mode);

      try {
        for (const chunk of chunks) {
          const { sent, usedFallback: fellBack } = await sendWithParseFallback(
            (parseMode) =>
              deps.telegram.sendMessage({
                chatId: deps.channelId,
                text: chunk,
                parseMode,
                disableLinkPreview: disable_link_preview,
                silent
              }),
            activeParseMode
          );
          posted.push(sent);
          deps.registry.record({
            messageId: sent.messageId,
            kind: 'text',
            content: chunk,
            link: sent.link
          });
          if (fellBack) {
            usedFallback = true;
            activeParseMode = undefined;
          }
        }
      } catch (error) {
        deps.logger.error('post_to_channel failed', {
          message: errorMessage(error),
          postedChunks: posted.length,
          totalChunks: chunks.length
        });
        const partial =
          posted.length > 0
            ? ` Before the failure, message_id(s) ${posted.map((p) => p.messageId).join(', ')} were already posted.`
            : '';
        return toolError(`Failed to post to ${deps.channelId}: ${errorMessage(error)}${partial}`);
      }

      deps.logger.info('post_to_channel succeeded', {
        messageCount: posted.length,
        messageIds: posted.map((p) => p.messageId)
      });
      return toolText(summarize(deps.channelId, posted, usedFallback));
    }
  );
}
