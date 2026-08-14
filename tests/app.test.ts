import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { TelegramClient } from '../src/telegram/client.js';
import { createLogger } from '../src/utils/logger.js';

const AUTH_TOKEN = 'f0e1d2c3b4a5968778695a4b3c2d1e0f1234567890abcdef';

const stubTelegram = (): TelegramClient =>
  ({
    sendMessage: vi.fn(),
    sendPhoto: vi.fn(),
    getChat: vi.fn(),
    getMe: vi.fn(),
    getChatMember: vi.fn()
  }) as unknown as TelegramClient;

const app = () =>
  buildApp({
    mcpAuthToken: AUTH_TOKEN,
    logger: createLogger('error'),
    telegram: stubTelegram(),
    channelId: '@testchannel'
  });

const MCP_HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json'
} as const;

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0.0.0' }
  }
} as const;

describe('buildApp', () => {
  it('responds 200 "ok" on GET /healthz without auth', async () => {
    const res = await request(app()).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app()).get('/nope');

    expect(res.status).toBe(404);
  });

  it('does not advertise the framework via X-Powered-By', async () => {
    const res = await request(app()).get('/healthz');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  describe('/mcp', () => {
    it('rejects POST without a token', async () => {
      const res = await request(app()).post('/mcp').send(initializeBody);

      expect(res.status).toBe(401);
    });

    it('rejects POST with a wrong token', async () => {
      const res = await request(app())
        .post('/mcp')
        .set({ ...MCP_HEADERS, Authorization: 'Bearer wrong-token-wrong-token-wrong-token' })
        .send(initializeBody);

      expect(res.status).toBe(401);
    });

    it('rejects GET with 405 and a JSON-RPC error (stateless mode offers no SSE stream)', async () => {
      const res = await request(app())
        .get('/mcp')
        .set('Authorization', `Bearer ${AUTH_TOKEN}`);

      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe(-32000);
    });

    it('rejects DELETE with 405 (no sessions to terminate in stateless mode)', async () => {
      const res = await request(app())
        .delete('/mcp')
        .set('Authorization', `Bearer ${AUTH_TOKEN}`);

      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe(-32000);
    });

    it('answers an initialize request with serverInfo', async () => {
      const res = await request(app()).post('/mcp').set(MCP_HEADERS).send(initializeBody);

      expect(res.status).toBe(200);
      expect(res.body.result.serverInfo).toEqual({
        name: 'telegram-channel-poster',
        version: expect.any(String)
      });
      expect(res.body.result.protocolVersion).toBeDefined();
      expect(res.body.id).toBe(1);
    });

    it('handles non-initialize requests statelessly (no "initialize first" rejection)', async () => {
      const res = await request(app())
        .post('/mcp')
        .set(MCP_HEADERS)
        .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(2);
      expect(res.body.result.tools).toHaveLength(3);
    });

    it('does not leak a session ID header in stateless mode', async () => {
      const res = await request(app()).post('/mcp').set(MCP_HEADERS).send(initializeBody);

      expect(res.headers['mcp-session-id']).toBeUndefined();
    });
  });
});
