import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';

import { requireBearerAuth } from './auth.js';
import { rateLimit } from './rate-limit.js';
import { requestLogger } from './request-logger.js';
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
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

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
  // Render terminates TLS at its proxy; trust the first hop so req.ip is the real client.
  app.set('trust proxy', 1);

  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  const auth = requireBearerAuth(mcpAuthToken);
  const limiter = rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS });
  app.use('/mcp', requestLogger(logger), limiter);

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
  // The shared requestLogger + limiter above cover these routes too.
  app.get('/mcp', auth, methodNotAllowed);
  app.delete('/mcp', auth, methodNotAllowed);

  return app;
}
