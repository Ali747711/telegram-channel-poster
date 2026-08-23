import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDeletePost } from './tools/delete-post.js';
import type { ToolDeps } from './tools/deps.js';
import { registerEditPost } from './tools/edit-post.js';
import { registerGetChannelInfo } from './tools/get-channel-info.js';
import { registerPinPost } from './tools/pin-post.js';
import { registerGetPost, registerListRecentPosts } from './tools/post-details.js';
import { registerPostDocument } from './tools/post-document.js';
import { registerPostMediaGroup } from './tools/post-media-group.js';
import { registerPostPhoto } from './tools/post-photo.js';
import { registerPostPoll } from './tools/post-poll.js';
import { registerPostToChannel } from './tools/post-to-channel.js';
import { registerPostVideo } from './tools/post-video.js';
import { registerSchedulePost } from './tools/schedule-post.js';
import { registerUserTools, type UserToolDeps } from './tools/user-tools.js';

export const SERVER_NAME = 'telegram-channel-poster';
export const SERVER_VERSION = '0.3.0';

/**
 * Builds a fresh McpServer instance. The app creates one per request
 * (stateless Streamable HTTP), so this must stay cheap and side-effect free.
 */
export function buildMcpServer(deps: ToolDeps | UserToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerPostToChannel(server, deps);
  registerPostPhoto(server, deps);
  registerPostVideo(server, deps);
  registerPostDocument(server, deps);
  registerPostMediaGroup(server, deps);
  registerPostPoll(server, deps);
  registerEditPost(server, deps);
  registerDeletePost(server, deps);
  registerPinPost(server, deps); // registers pin_post + unpin_post
  registerSchedulePost(server, deps); // registers schedule_post + list_scheduled_posts + cancel_scheduled_post
  registerGetPost(server, deps);
  registerListRecentPosts(server, deps);
  registerGetChannelInfo(server, deps);

  // User-account tools exist only when a personal Telegram session is configured.
  if ('userClient' in deps) {
    registerUserTools(server, deps);
  }

  return server;
}
