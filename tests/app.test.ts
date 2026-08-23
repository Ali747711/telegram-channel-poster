import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createFileStore } from '../src/file-store.js';
import { createPostRegistry } from '../src/post-registry.js';
import { createScheduleStore } from '../src/schedule-store.js';
import { createMemoryKv } from '../src/storage/kv.js';
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

const app = () => {
  const kv = createMemoryKv();
  return buildApp({
    mcpAuthToken: AUTH_TOKEN,
    logger: createLogger('error'),
    telegram: stubTelegram(),
    channelId: '@testchannel',
    registry: createPostRegistry(kv),
    schedule: createScheduleStore(kv),
    files: createFileStore(),
    persistent: false
  });
};

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
      expect(res.body.result.tools).toHaveLength(16);
    });

    describe('/upload', () => {
      it('rejects uploads without the token', async () => {
        const res = await request(app()).post('/upload').send(Buffer.from('data'));

        expect(res.status).toBe(401);
      });

      it('stores an uploaded file and returns a usable file_id', async () => {
        const res = await request(app())
          .post('/upload')
          .set('Authorization', `Bearer ${AUTH_TOKEN}`)
          .set('X-Filename', 'photo.jpg')
          .set('Content-Type', 'image/jpeg')
          .send(Buffer.from('raw-image-bytes'));

        expect(res.status).toBe(200);
        expect(res.body.file_id).toMatch(/[0-9a-f-]{36}/);
        expect(res.body.bytes).toBe(15);
        expect(res.body.expires_in_minutes).toBeGreaterThan(0);
      });

      it('rejects an empty body', async () => {
        const res = await request(app())
          .post('/upload')
          .set('Authorization', `Bearer ${AUTH_TOKEN}`)
          .set('Content-Type', 'application/octet-stream')
          .send();

        expect(res.status).toBe(400);
      });
    });

    it('rate-limits /mcp after 30 requests in a minute', async () => {
      const shared = app();

      let lastStatus = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await request(shared).post('/mcp').send({});
        lastStatus = res.status;
      }

      expect(lastStatus).toBe(429);
    });

    it('does not leak a session ID header in stateless mode', async () => {
      const res = await request(app()).post('/mcp').set(MCP_HEADERS).send(initializeBody);

      expect(res.headers['mcp-session-id']).toBeUndefined();
    });
  });
});
