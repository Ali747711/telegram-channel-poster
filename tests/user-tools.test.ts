import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createFileStore } from '../src/file-store.js';
import { createPostRegistry } from '../src/post-registry.js';
import { createScheduleStore } from '../src/schedule-store.js';
import { createMemoryKv } from '../src/storage/kv.js';
import { DM_DAILY_LIMIT } from '../src/telegram/dm-guard.js';
import type { TelegramClient } from '../src/telegram/client.js';
import type { TelegramUserClient } from '../src/telegram/user-client.js';
import { createLogger } from '../src/utils/logger.js';

const AUTH_TOKEN = 'f0e1d2c3b4a5968778695a4b3c2d1e0f1234567890abcdef';
const MCP_HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json'
} as const;

const fakeUserClient = () => {
  const mocks = {
    getMe: vi.fn(async () => ({ id: '555', username: 'me', firstName: 'Me' })),
    listDialogs: vi.fn(async () => [
      {
        id: '1001',
        title: 'Best Friend',
        kind: 'user' as const,
        username: 'bestie',
        unreadCount: 3,
        lastMessageAt: '2026-08-24T08:00:00.000Z'
      },
      {
        id: '777000',
        title: 'Telegram',
        kind: 'user' as const,
        unreadCount: 1,
        lastMessageAt: '2026-08-24T07:00:00.000Z'
      },
      {
        id: '-100500',
        title: 'Tech News Channel',
        kind: 'channel' as const,
        username: 'technews',
        unreadCount: 42,
        lastMessageAt: '2026-08-24T09:00:00.000Z'
      }
    ]),
    listFolders: vi.fn(async () => [
      { id: 2, title: 'Reading', chatCount: 5 },
      { id: 3, title: 'Work', chatCount: 12 }
    ]),
    readHistory: vi.fn(async () => [
      {
        id: 9,
        chatId: '1001',
        chatTitle: 'Best Friend',
        senderName: 'Best Friend',
        text: 'are we still on for saturday?',
        date: '2026-08-24T08:00:00.000Z',
        outgoing: false
      },
      {
        id: 8,
        chatId: '1001',
        chatTitle: 'Best Friend',
        senderName: 'Me',
        text: 'yes!',
        date: '2026-08-24T07:59:00.000Z',
        outgoing: true
      }
    ]),
    searchMessages: vi.fn(async () => [
      {
        id: 77,
        chatId: '-100500',
        chatTitle: 'Tech News Channel',
        senderName: 'Tech News Channel',
        text: 'MCP adoption is accelerating',
        date: '2026-08-24T09:00:00.000Z',
        outgoing: false
      }
    ]),
    sendDm: vi.fn(async () => ({ messageId: 4242 })),
    disconnect: vi.fn(async () => {})
  };
  return { client: mocks as unknown as TelegramUserClient, ...mocks };
};

const stubBot = (): TelegramClient => ({ sendMessage: vi.fn() }) as unknown as TelegramClient;

const appWith = (userClient?: TelegramUserClient) => {
  const kv = createMemoryKv();
  return buildApp({
    mcpAuthToken: AUTH_TOKEN,
    logger: createLogger('error'),
    telegram: stubBot(),
    channelId: '@testchannel',
    registry: createPostRegistry(kv),
    schedule: createScheduleStore(kv),
    files: createFileStore(),
    persistent: false,
    kv,
    userClient
  });
};

const callToolOn = (app: ReturnType<typeof appWith>, name: string, args: Record<string, unknown>) =>
  request(app)
    .post('/mcp')
    .set(MCP_HEADERS)
    .send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });

const listTools = async (app: ReturnType<typeof appWith>): Promise<string[]> => {
  const res = await request(app)
    .post('/mcp')
    .set(MCP_HEADERS)
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  return (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
};

describe('user-account tools', () => {
  it('are absent when no user session is configured', async () => {
    const names = await listTools(appWith());

    expect(names).not.toContain('send_dm');
    expect(names).not.toContain('list_chats');
    expect(names).toContain('post_to_channel');
  });

  it('are registered when a user client is configured', async () => {
    const names = await listTools(appWith(fakeUserClient().client));

    expect(names).toEqual(
      expect.arrayContaining([
        'list_chats',
        'list_folders',
        'read_chat_history',
        'search_messages',
        'pull_channel_posts',
        'send_dm',
        'whoami'
      ])
    );
  });

  describe('list_chats', () => {
    it('lists dialogs with unread counts and hides the Telegram service chat', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'list_chats', {});

      const text = res.body.result.content[0].text as string;
      expect(text).toContain('Best Friend');
      expect(text).toContain('Tech News Channel');
      expect(text).toContain('3 unread');
      // service chat carries login codes — never listed
      expect(text).not.toContain('777000');
    });

    it('asks the client to apply the unread filter (so the limit counts unread chats)', async () => {
      const fake = fakeUserClient();

      await callToolOn(appWith(fake.client), 'list_chats', { limit: 5, unread_only: true });

      expect(fake.listDialogs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, unreadOnly: true })
      );
    });

    it('can filter to unread chats only', async () => {
      const fake = fakeUserClient();
      fake.listDialogs.mockResolvedValue([
        { id: '1', title: 'Quiet', kind: 'user', unreadCount: 0 },
        { id: '2', title: 'Loud', kind: 'user', unreadCount: 7 }
      ] as never);

      const res = await callToolOn(appWith(fake.client), 'list_chats', { unread_only: true });

      const text = res.body.result.content[0].text as string;
      expect(text).toContain('Loud');
      expect(text).not.toContain('Quiet');
    });
  });

  describe('read_chat_history', () => {
    it('returns messages with sender and direction', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'read_chat_history', { chat: '@bestie', limit: 10 });

      expect(fake.readHistory).toHaveBeenCalledWith({ chat: '@bestie', limit: 10 });
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('are we still on for saturday?');
      expect(text).toContain('Me');
    });

    it('refuses to read the Telegram service chat', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'read_chat_history', { chat: '777000' });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/service chat|login code/i);
      expect(fake.readHistory).not.toHaveBeenCalled();
    });

    it('redacts login codes that appear in ordinary chats', async () => {
      const fake = fakeUserClient();
      fake.readHistory.mockResolvedValue([
        {
          id: 1,
          chatId: '1001',
          chatTitle: 'Friend',
          senderName: 'Friend',
          text: 'forwarded: Login code: 98765',
          date: '2026-08-24T08:00:00.000Z',
          outgoing: false
        }
      ] as never);

      const res = await callToolOn(appWith(fake.client), 'read_chat_history', { chat: '1001' });

      expect(res.body.result.content[0].text).not.toContain('98765');
    });
  });

  describe('pull_channel_posts', () => {
    it('reads recent posts from a channel the user has joined', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'pull_channel_posts', {
        channel: '@technews',
        limit: 5
      });

      expect(fake.readHistory).toHaveBeenCalledWith({ chat: '@technews', limit: 5 });
      expect(res.body.result.isError).toBeFalsy();
    });
  });

  describe('search_messages', () => {
    it('searches across chats and reports where each hit came from', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'search_messages', { query: 'MCP' });

      expect(fake.searchMessages).toHaveBeenCalledWith({ query: 'MCP', chat: undefined, limit: 20 });
      expect(res.body.result.content[0].text).toContain('Tech News Channel');
    });
  });

  describe('send_dm', () => {
    it('refuses to send without confirm: true', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'send_dm', {
        to: '@bestie',
        text: 'hi',
        confirm: false
      });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/confirm/i);
      expect(fake.sendDm).not.toHaveBeenCalled();
    });

    it('sends when confirmed and reports the remaining daily budget', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'send_dm', {
        to: '@bestie',
        text: 'on my way',
        confirm: true
      });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendDm).toHaveBeenCalledWith({ to: '@bestie', text: 'on my way' });
      expect(res.body.result.content[0].text).toMatch(new RegExp(`${DM_DAILY_LIMIT - 1} .*remaining`, 'i'));
    });

    it('enforces the daily send cap', async () => {
      const fake = fakeUserClient();
      const app = appWith(fake.client);
      for (let i = 0; i < DM_DAILY_LIMIT; i += 1) {
        await callToolOn(app, 'send_dm', { to: '@bestie', text: `msg ${i}`, confirm: true });
      }
      fake.sendDm.mockClear();

      const res = await callToolOn(app, 'send_dm', { to: '@bestie', text: 'one too many', confirm: true });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/daily limit/i);
      expect(fake.sendDm).not.toHaveBeenCalled();
    });

    it('never sends to the Telegram service chat', async () => {
      const fake = fakeUserClient();

      const res = await callToolOn(appWith(fake.client), 'send_dm', {
        to: '777000',
        text: 'hello',
        confirm: true
      });

      expect(res.body.result.isError).toBe(true);
      expect(fake.sendDm).not.toHaveBeenCalled();
    });
  });

  describe('whoami', () => {
    it('reports the logged-in account', async () => {
      const res = await callToolOn(appWith(fakeUserClient().client), 'whoami', {});

      expect(res.body.result.content[0].text).toContain('@me');
    });
  });
});
