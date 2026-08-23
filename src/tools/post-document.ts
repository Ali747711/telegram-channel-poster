import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, sendWithParseFallback, toParseMode, toolError, toolText } from './helpers.js';
import { resolveMediaSource } from './media-source.js';

const inputSchema = {
  document_url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), {
      message: 'document_url must be an http(s) URL'
    })
    .optional()
    .describe('Publicly reachable file URL (PDF, ZIP, any document — Telegram fetches it server-side).'),
  file_id: z
    .string()
    .optional()
    .describe('Alternative to document_url: id of a file uploaded via POST /upload (local files).'),
  caption: z.string().min(1).max(1024).optional().describe('Optional caption, max 1024 chars.'),
  parse_mode: z.enum(['HTML', 'MarkdownV2', 'none']).default('HTML'),
  silent: z.boolean().default(false).describe('Post without notifying subscribers.')
};

export function registerPostDocument(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_document',
    {
      title: 'Post a document to Telegram channel',
      description:
        `Publish a file (PDF, archive, any document, ≤20MB uploaded / ≤20MB by URL) to ${deps.channelId}, ` +
        'by public URL or by file_id from POST /upload. Returns the message ID and link.',
      inputSchema
    },
    async ({ document_url, file_id, caption, parse_mode, silent }) => {
      const source = resolveMediaSource(deps, document_url, file_id);
      if (source.error !== undefined) {
        return toolError(source.error);
      }
      try {
        const { sent, usedFallback } = await sendWithParseFallback(
          (parseMode) =>
            deps.telegram.sendDocument({
              chatId: deps.channelId,
              documentUrl: source.url,
              documentFile: source.file,
              caption,
              parseMode,
              silent
            }),
          toParseMode(parse_mode)
        );
        await deps.registry.record({
          messageId: sent.messageId,
          kind: 'document',
          content: caption ?? source.file?.filename ?? '(document)',
          link: sent.link
        });
        deps.logger.info('post_document succeeded', { messageId: sent.messageId });
        const link = sent.link !== undefined ? ` Link: ${sent.link}` : '';
        const note = usedFallback ? ' Note: caption formatting failed, posted as plain text.' : '';
        return toolText(`Posted document to ${deps.channelId}: message_id ${sent.messageId}.${link}${note}`);
      } catch (error) {
        deps.logger.error('post_document failed', { message: errorMessage(error) });
        return toolError(`Failed to post document to ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
