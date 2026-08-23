import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

const inputSchema = {
  message_id: z.number().int().positive().describe('ID of the post to delete permanently.'),
  confirm: z
    .boolean()
    .describe(
      'Must be true. Deletion is permanent and cannot be undone — confirm with the user before setting this.'
    )
};

export function registerDeletePost(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'delete_post',
    {
      title: 'Delete a channel post',
      description:
        `Permanently delete a post from ${deps.channelId} by message ID. Destructive and ` +
        'irreversible — requires confirm: true, and the user should have explicitly asked for deletion.',
      inputSchema
    },
    async ({ message_id, confirm }) => {
      if (confirm !== true) {
        return toolError(
          `Refusing to delete message_id ${message_id}: deletion is permanent. ` +
            'Pass confirm: true only after the user explicitly confirms.'
        );
      }

      try {
        await deps.telegram.deleteMessage(deps.channelId, message_id);
        await deps.registry.markDeleted(message_id);
        deps.logger.info('delete_post succeeded', { messageId: message_id });
        return toolText(`Deleted message_id ${message_id} from ${deps.channelId}.`);
      } catch (error) {
        deps.logger.error('delete_post failed', { messageId: message_id, message: errorMessage(error) });
        return toolError(`Failed to delete message_id ${message_id}: ${errorMessage(error)}`);
      }
    }
  );
}
