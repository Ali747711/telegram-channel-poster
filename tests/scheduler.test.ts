import { describe, expect, it, vi } from 'vitest';

import { createPostRegistry } from '../src/post-registry.js';
import { createScheduleStore, type ScheduledPost } from '../src/schedule-store.js';
import { runSchedulerTick } from '../src/scheduler.js';
import { createMemoryKv } from '../src/storage/kv.js';
import type { TelegramClient } from '../src/telegram/client.js';
import type { Logger } from '../src/utils/logger.js';

const silentLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const entry = (id: string, publishAtMs: number, text = 'scheduled text'): ScheduledPost => ({
  id,
  text,
  parseMode: 'HTML',
  disableLinkPreview: true,
  silent: false,
  publishAtMs,
  createdAt: new Date(0).toISOString()
});

const setup = async (entries: ScheduledPost[], sendMessage = vi.fn()) => {
  const kv = createMemoryKv();
  const schedule = createScheduleStore(kv);
  const registry = createPostRegistry(kv);
  for (const e of entries) {
    await schedule.add(e);
  }
  sendMessage.mockResolvedValue({ messageId: 77, link: 'https://t.me/x/77' });
  const telegram = { sendMessage } as unknown as TelegramClient;
  return { schedule, registry, telegram, sendMessage };
};

describe('runSchedulerTick', () => {
  it('publishes due posts, records them and removes them from the queue', async () => {
    const { schedule, registry, telegram, sendMessage } = await setup([entry('due', 1000), entry('later', 9_999_999)]);

    const posted = await runSchedulerTick({
      schedule,
      registry,
      telegram,
      channelId: '@chan',
      logger: silentLogger,
      nowFn: () => 5000
    });

    expect(posted).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: '@chan',
      text: 'scheduled text',
      parseMode: 'HTML',
      disableLinkPreview: true,
      silent: false
    });
    expect((await schedule.list()).map((s) => s.id)).toEqual(['later']);
    expect((await registry.get(77))?.content).toBe('scheduled text');
  });

  it('keeps a failed post in the queue for the next tick', async () => {
    const { schedule, registry, telegram, sendMessage } = await setup([entry('due', 1000)]);
    sendMessage.mockRejectedValue(new Error('boom'));

    const posted = await runSchedulerTick({
      schedule,
      registry,
      telegram,
      channelId: '@chan',
      logger: silentLogger,
      nowFn: () => 5000
    });

    expect(posted).toBe(0);
    expect((await schedule.list()).map((s) => s.id)).toEqual(['due']);
  });

  it('drops posts that are more than a day overdue instead of publishing them', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const sendMessage = vi.fn();
    const { schedule, telegram, registry } = await setup([entry('stale', 1000)], sendMessage);

    const posted = await runSchedulerTick({
      schedule,
      registry,
      telegram,
      channelId: '@chan',
      logger: silentLogger,
      nowFn: () => 1000 + dayMs + 1
    });

    expect(posted).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await schedule.list()).toEqual([]);
  });
});
