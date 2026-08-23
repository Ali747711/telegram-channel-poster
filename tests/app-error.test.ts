import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createFileStore } from '../src/file-store.js';
import { createPostRegistry } from '../src/post-registry.js';
import { createScheduleStore } from '../src/schedule-store.js';
import { createMemoryKv } from '../src/storage/kv.js';
import type { TelegramClient } from '../src/telegram/client.js';
import type { Logger } from '../src/utils/logger.js';

// Force the MCP server wiring to fail so the /mcp catch path is exercised.
vi.mock('../src/server.js', () => ({
  buildMcpServer: () => ({
    connect: () => Promise.reject(new Error('boom')),
    close: () => Promise.resolve()
  })
}));

const AUTH_TOKEN = 'f0e1d2c3b4a5968778695a4b3c2d1e0f1234567890abcdef';

describe('buildApp /mcp error handling', () => {
  it('logs the failure and answers 500 with a JSON-RPC internal error', async () => {
    const errorSpy = vi.fn();
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorSpy };

    const telegram = { getChat: vi.fn() } as unknown as TelegramClient;
    const kv = createMemoryKv();

    const res = await request(
      buildApp({
        mcpAuthToken: AUTH_TOKEN,
        logger,
        telegram,
        channelId: '@x',
        registry: createPostRegistry(kv),
        schedule: createScheduleStore(kv),
        files: createFileStore(),
        persistent: false,
        kv
      })
    )
      .post('/mcp')
      .set({
        Authorization: `Bearer ${AUTH_TOKEN}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      })
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(-32603);
    expect(errorSpy).toHaveBeenCalledWith('mcp request failed', { message: 'boom' });
    // The response must not leak internals beyond the generic message.
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });
});
