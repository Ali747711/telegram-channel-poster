import { basename } from 'node:path';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';

import { requireBearerAuth } from './auth.js';
import type { FileStore } from './file-store.js';
import type { PostRegistry } from './post-registry.js';
import { rateLimit } from './rate-limit.js';
import { requestLogger } from './request-logger.js';
import type { ScheduleStore } from './schedule-store.js';
import { buildMcpServer } from './server.js';
import type { TelegramClient } from './telegram/client.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  readonly mcpAuthToken: string;
  readonly logger: Logger;
  readonly telegram: TelegramClient;
  readonly channelId: string;
  readonly registry: PostRegistry;
  readonly schedule: ScheduleStore;
  readonly files: FileStore;
  readonly persistent: boolean;
}

const JSON_BODY_LIMIT = '1mb';
const UPLOAD_BODY_LIMIT = '21mb';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const methodNotAllowed = (_req: Request, res: Response): void => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
};

const safeFilename = (header: unknown): string => {
  const raw = typeof header === 'string' && header.length > 0 ? header : 'upload.bin';
  return basename(raw).slice(0, 200);
};

/**
 * HTTP app: open /healthz for Render health checks; bearer-gated /mcp (MCP over
 * stateless Streamable HTTP) and /upload (raw-body file uploads that media
 * tools can reference by file_id).
 */
export function buildApp(deps: AppDeps): Express {
  const { mcpAuthToken, logger, telegram, channelId, registry, schedule, files, persistent } = deps;
  const app = express();
  app.disable('x-powered-by');
  // Render terminates TLS at its proxy; trust the first hop so req.ip is the real client.
  app.set('trust proxy', 1);

  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  const auth = requireBearerAuth(mcpAuthToken);
  const limiter = rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS });
  app.use(['/mcp', '/upload'], requestLogger(logger), limiter);

  app.post('/mcp', auth, express.json({ limit: JSON_BODY_LIMIT }), async (req, res) => {
    const server = buildMcpServer({ telegram, channelId, logger, registry, schedule, files, persistent });
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

  // Raw-body upload: body = the file bytes, X-Filename header names it.
  // Returns a short-lived file_id the media tools accept instead of a URL.
  app.post('/upload', auth, express.raw({ type: () => true, limit: UPLOAD_BODY_LIMIT }), (req, res) => {
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.byteLength === 0) {
      res.status(400).json({ error: 'empty body — send the raw file bytes as the request body' });
      return;
    }
    try {
      const fileId = files.put({
        data,
        filename: safeFilename(req.get('x-filename')),
        contentType: req.get('content-type') ?? 'application/octet-stream'
      });
      logger.info('file uploaded', { fileId, bytes: data.byteLength });
      res.status(200).json({
        file_id: fileId,
        bytes: data.byteLength,
        expires_in_minutes: Math.round(files.ttlMs / 60_000),
        usage: 'pass as file_id to post_photo / post_video / post_document'
      });
    } catch (error) {
      res.status(413).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Stateless mode: no SSE stream to GET, no session to DELETE (MCP spec: reply 405).
  // The shared requestLogger + limiter above cover these routes too.
  app.get('/mcp', auth, methodNotAllowed);
  app.delete('/mcp', auth, methodNotAllowed);

  return app;
}
