import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

export function registerGetChannelInfo(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_channel_info',
    {
      title: 'Get channel info',
      description:
        'Returns the configured channel’s title, ID and type, and whether the bot has ' +
        'posting rights. Call this first when debugging the connection or before a batch of posts.',
      inputSchema: {}
    },
    async () => {
      try {
        const chat = await deps.telegram.getChat(deps.channelId);
        const me = await deps.telegram.getMe();
        const member = await deps.telegram.getChatMember(chat.id, me.id);

        const canPost =
          member.status === 'creator' ||
          (member.status === 'administrator' && member.canPostMessages === true);
        const username = chat.username !== undefined ? ` (@${chat.username})` : '';
        const hint = canPost
          ? ''
          : ` Add @${me.username} as a channel administrator with the "Post Messages" permission.`;

        return toolText(
          `Channel: ${chat.title ?? 'untitled'}${username}, id ${chat.id}, type ${chat.type}. ` +
            `Bot @${me.username} posting rights: ${canPost ? 'yes' : 'no'} (status: ${member.status}).${hint}`
        );
      } catch (error) {
        deps.logger.error('get_channel_info failed', { message: errorMessage(error) });
        return toolError(`Could not read channel info for ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
