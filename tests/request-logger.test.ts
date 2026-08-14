import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { requestLogger } from '../src/request-logger.js';
import type { Logger } from '../src/utils/logger.js';

const spyLogger = () => {
  const info = vi.fn();
  const logger: Logger = { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() };
  return { logger, info };
};

const buildLoggedApp = (logger: Logger): Express => {
  const app = express();
  app.use('/mcp', requestLogger(logger));
  app.post('/mcp', (_req, res) => {
    res.status(401).json({ error: 'unauthorized' });
  });
  return app;
};

describe('requestLogger', () => {
  it('logs method, path, status and duration once the response finishes', async () => {
    const { logger, info } = spyLogger();

    await request(buildLoggedApp(logger))
      .post('/mcp')
      .set('Authorization', 'Bearer super-secret-token-value')
      .send({ a: 1 });

    expect(info).toHaveBeenCalledTimes(1);
    const [message, context] = info.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('http request');
    expect(context.method).toBe('POST');
    expect(context.path).toBe('/mcp');
    expect(context.status).toBe(401);
    expect(typeof context.durationMs).toBe('number');
  });

  it('never logs the Authorization header or the request body', async () => {
    const { logger, info } = spyLogger();
    const secret = 'super-secret-token-value';

    await request(buildLoggedApp(logger))
      .post('/mcp')
      .set('Authorization', `Bearer ${secret}`)
      .send({ text: 'secret post body' });

    const everything = JSON.stringify(info.mock.calls);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('secret post body');
  });
});
