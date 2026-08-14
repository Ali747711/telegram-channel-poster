import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDeletePost } from './tools/delete-post.js';
import type { ToolDeps } from './tools/deps.js';
import { registerEditPost } from './tools/edit-post.js';
import { registerGetChannelInfo } from './tools/get-channel-info.js';
import { registerGetPost, registerListRecentPosts } from './tools/post-details.js';
import { registerPostPhoto } from './tools/post-photo.js';
import { registerPostToChannel } from './tools/post-to-channel.js';
import { registerPostVideo } from './tools/post-video.js';

export const SERVER_NAME = 'telegram-channel-poster';
export const SERVER_VERSION = '0.1.0';

/**
 * Builds a fresh McpServer instance. The app creates one per request
 * (stateless Streamable HTTP), so this must stay cheap and side-effect free.
 */
export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerPostToChannel(server, deps);
  registerPostPhoto(server, deps);
  registerPostVideo(server, deps);
  registerEditPost(server, deps);
  registerDeletePost(server, deps);
  registerGetPost(server, deps);
  registerListRecentPosts(server, deps);
  registerGetChannelInfo(server, deps);

  return server;
}
