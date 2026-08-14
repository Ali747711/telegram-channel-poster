import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';

import { requireBearerAuth } from './auth.js';
import { buildMcpServer } from './server.js';
import type { TelegramClient } from './telegram/client.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  readonly mcpAuthToken: string;
  readonly logger: Logger;
  readonly telegram: TelegramClient;
  readonly channelId: string;
}

const JSON_BODY_LIMIT = '1mb';

const methodNotAllowed = (_req: Request, res: Response): void => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
};

/**
 * HTTP app: open /healthz for Render health checks, bearer-gated /mcp for Claude.
 * /mcp runs the Streamable HTTP transport in stateless mode — a fresh
 * McpServer + transport per request, no sessions, plain JSON responses.
 */
export function buildApp({ mcpAuthToken, logger, telegram, channelId }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  const auth = requireBearerAuth(mcpAuthToken);

  app.post('/mcp', auth, express.json({ limit: JSON_BODY_LIMIT }), async (req, res) => {
    const server = buildMcpServer({ telegram, channelId, logger });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    const logCleanupFailure = (error: unknown): void => {
      logger.debug('mcp cleanup failed', {
        message: error instanceof Error ? error.message : String(error)
      });
    };
    res.on('close', () => {
      transport.close().catch(logCleanupFailure);
      server.close().catch(logCleanupFailure);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('mcp request failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  // Stateless mode: no SSE stream to GET, no session to DELETE (MCP spec: reply 405).
  app.get('/mcp', auth, methodNotAllowed);
  app.delete('/mcp', auth, methodNotAllowed);

  return app;
}
