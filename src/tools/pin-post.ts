import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

const RIGHTS_HINT =
  ' Pinning in channels requires the bot to have the "Edit Messages" admin right — check the bot\'s admin settings.';

export function registerPinPost(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'pin_post',
    {
      title: 'Pin a channel post',
      description:
        `Pin a post in ${deps.channelId} by message ID (quietly by default). ` +
        'Requires the "Edit Messages" admin right for the bot.',
      inputSchema: {
        message_id: z.number().int().positive().describe('ID of the post to pin.'),
        silent: z.boolean().default(true).describe('Pin without notifying subscribers (default true).')
      }
    },
    async ({ message_id, silent }) => {
      try {
        await deps.telegram.pinChatMessage(deps.channelId, message_id, silent);
        deps.logger.info('pin_post succeeded', { messageId: message_id });
        return toolText(`Pinned message_id ${message_id} in ${deps.channelId}.`);
      } catch (error) {
        deps.logger.error('pin_post failed', { messageId: message_id, message: errorMessage(error) });
        return toolError(`Failed to pin message_id ${message_id}: ${errorMessage(error)}${RIGHTS_HINT}`);
      }
    }
  );

  server.registerTool(
    'unpin_post',
    {
      title: 'Unpin a channel post',
      description: `Unpin a post in ${deps.channelId} by message ID.`,
      inputSchema: {
        message_id: z.number().int().positive().describe('ID of the post to unpin.')
      }
    },
    async ({ message_id }) => {
      try {
        await deps.telegram.unpinChatMessage(deps.channelId, message_id);
        deps.logger.info('unpin_post succeeded', { messageId: message_id });
        return toolText(`Unpinned message_id ${message_id} in ${deps.channelId}.`);
      } catch (error) {
        deps.logger.error('unpin_post failed', { messageId: message_id, message: errorMessage(error) });
        return toolError(`Failed to unpin message_id ${message_id}: ${errorMessage(error)}${RIGHTS_HINT}`);
      }
    }
  );
}
