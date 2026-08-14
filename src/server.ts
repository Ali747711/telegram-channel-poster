import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolDeps } from './tools/deps.js';
import { registerGetChannelInfo } from './tools/get-channel-info.js';
import { registerPostPhoto } from './tools/post-photo.js';
import { registerPostToChannel } from './tools/post-to-channel.js';

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
  registerGetChannelInfo(server, deps);

  return server;
}
