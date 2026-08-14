import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { PostRecord } from '../post-registry.js';
import type { ToolDeps } from './deps.js';
import { toolText } from './helpers.js';

const MAX_CONTENT_PREVIEW = 200;

const RESTART_CAVEAT =
  'The registry only tracks posts made through this server since its last restart ' +
  '(the free hosting tier restarts after idle periods).';

const formatRecord = (post: PostRecord): string => {
  const flags = [
    post.deletedAt !== undefined ? 'deleted' : '',
    post.editedAt !== undefined ? 'edited' : ''
  ]
    .filter((flag) => flag.length > 0)
    .join(', ');
  const preview =
    post.content.length > MAX_CONTENT_PREVIEW
      ? `${post.content.slice(0, MAX_CONTENT_PREVIEW)}…`
      : post.content;
  const link = post.link !== undefined ? ` ${post.link}` : '';
  return `#${post.messageId} [${post.kind}${flags ? `, ${flags}` : ''}] posted ${post.postedAt}: "${preview}"${link}`;
};

export function registerGetPost(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_post',
    {
      title: 'Get post details',
      description:
        'Look up a post made through this server by message ID: content, kind, link, ' +
        'posted/edited/deleted timestamps. Best-effort — see the restart caveat in results.',
      inputSchema: {
        message_id: z.number().int().positive().describe('Message ID to look up.')
      }
    },
    async ({ message_id }) => {
      const post = deps.registry.get(message_id);
      if (post === undefined) {
        return toolText(`No record of message_id ${message_id}. ${RESTART_CAVEAT}`);
      }
      return toolText(formatRecord(post));
    }
  );
}

export function registerListRecentPosts(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_recent_posts',
    {
      title: 'List recent posts',
      description:
        'List posts made through this server, newest first, with message IDs, content previews ' +
        'and edit/delete status. Use to find a message_id for edit_post/delete_post.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe('How many posts to return.')
      }
    },
    async ({ limit }) => {
      const posts = deps.registry.list(limit);
      if (posts.length === 0) {
        return toolText(`No posts tracked yet. ${RESTART_CAVEAT}`);
      }
      return toolText(posts.map(formatRecord).join('\n'));
    }
  );
}
