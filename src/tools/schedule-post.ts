import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

const MIN_LEAD_MS = 20_000;

const persistenceCaveat = (deps: ToolDeps): string =>
  deps.persistent
    ? ' The queue is persistent; if the server is asleep at publish time, the post goes out when it next wakes.'
    : ' CAUTION: the queue is in-memory — it is LOST if the server restarts or the free tier puts it to sleep. For reliable scheduling, configure Upstash Redis.';

export function registerSchedulePost(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'schedule_post',
    {
      title: 'Schedule a channel post',
      description:
        `Queue a text post for ${deps.channelId} to publish at a future time. ` +
        'Text posts only (media cannot be scheduled yet). Returns a schedule id for cancelling.',
      inputSchema: {
        text: z.string().min(1).max(4096).describe('Post content, same HTML rules as post_to_channel.'),
        publish_at: z
          .string()
          .datetime({ offset: true })
          .describe('ISO 8601 time WITH timezone offset, e.g. "2026-08-24T09:00:00+09:00".'),
        parse_mode: z.enum(['HTML', 'MarkdownV2', 'none']).default('HTML'),
        disable_link_preview: z.boolean().default(true),
        silent: z.boolean().default(false)
      }
    },
    async ({ text, publish_at, parse_mode, disable_link_preview, silent }) => {
      const publishAtMs = Date.parse(publish_at);
      if (publishAtMs < Date.now() + MIN_LEAD_MS) {
        return toolError(
          `publish_at (${publish_at}) is in the past or less than ${MIN_LEAD_MS / 1000}s away — use post_to_channel for immediate posts.`
        );
      }

      const id = randomUUID();
      await deps.schedule.add({
        id,
        text,
        ...(parse_mode !== 'none' ? { parseMode: parse_mode } : {}),
        disableLinkPreview: disable_link_preview,
        silent,
        publishAtMs,
        createdAt: new Date().toISOString()
      });
      deps.logger.info('schedule_post queued', { id, publishAtMs });
      return toolText(
        `Scheduled post ${id} for ${publish_at} (checked every ~30s).${persistenceCaveat(deps)}`
      );
    }
  );

  server.registerTool(
    'list_scheduled_posts',
    {
      title: 'List scheduled posts',
      description: 'List queued scheduled posts with their ids, publish times and previews.',
      inputSchema: {}
    },
    async () => {
      const posts = await deps.schedule.list();
      if (posts.length === 0) {
        return toolText(`No scheduled posts in the queue.${persistenceCaveat(deps)}`);
      }
      const lines = posts.map((p) => {
        const preview = p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text;
        return `${p.id} → ${new Date(p.publishAtMs).toISOString()}: "${preview}"`;
      });
      return toolText(lines.join('\n'));
    }
  );

  server.registerTool(
    'cancel_scheduled_post',
    {
      title: 'Cancel a scheduled post',
      description: 'Remove a queued post by its schedule id (from schedule_post or list_scheduled_posts).',
      inputSchema: {
        id: z.string().min(1).describe('The schedule id to cancel.')
      }
    },
    async ({ id }) => {
      const existing = (await deps.schedule.list()).find((p) => p.id === id);
      if (existing === undefined) {
        return toolError(`No scheduled post with id "${id}". Use list_scheduled_posts to see the queue.`);
      }
      await deps.schedule.remove(id);
      deps.logger.info('cancel_scheduled_post', { id });
      return toolText(`Cancelled scheduled post ${id} (was set for ${new Date(existing.publishAtMs).toISOString()}).`);
    }
  );
}
