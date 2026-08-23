import type { Kv } from './storage/kv.js';

export interface ScheduledPost {
  readonly id: string;
  readonly text: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly disableLinkPreview: boolean;
  readonly silent: boolean;
  readonly publishAtMs: number;
  readonly createdAt: string;
}

export interface ScheduleStore {
  readonly add: (post: ScheduledPost) => Promise<void>;
  readonly list: () => Promise<readonly ScheduledPost[]>;
  readonly due: (nowMs: number) => Promise<readonly ScheduledPost[]>;
  readonly remove: (id: string) => Promise<void>;
}

const ZSET_KEY = 'schedule:index';
const entryKey = (id: string): string => `schedule:${id}`;

/** Pending scheduled posts, ordered by publish time via a sorted set. */
export function createScheduleStore(kv: Kv): ScheduleStore {
  const readMany = async (ids: readonly string[]): Promise<readonly ScheduledPost[]> => {
    const raws = await Promise.all(ids.map((id) => kv.get(entryKey(id))));
    return raws
      .filter((raw): raw is string => raw !== undefined)
      .map((raw) => JSON.parse(raw) as ScheduledPost);
  };

  return Object.freeze({
    add: async (post: ScheduledPost): Promise<void> => {
      await kv.set(entryKey(post.id), JSON.stringify(post));
      await kv.zadd(ZSET_KEY, post.publishAtMs, post.id);
    },

    list: async (): Promise<readonly ScheduledPost[]> => readMany(await kv.zrange(ZSET_KEY, 0, -1)),

    due: async (nowMs: number): Promise<readonly ScheduledPost[]> =>
      readMany(await kv.zrangebyscore(ZSET_KEY, 0, nowMs)),

    remove: async (id: string): Promise<void> => {
      await kv.zrem(ZSET_KEY, id);
      await kv.del([entryKey(id)]);
    }
  });
}
