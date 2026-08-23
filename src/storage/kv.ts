/**
 * Minimal key-value abstraction covering exactly the Redis operations the
 * registry and schedule queue need. Two implementations: in-memory (default)
 * and Upstash Redis REST (see upstash.ts) for persistence across restarts.
 */
export interface Kv {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly del: (keys: readonly string[]) => Promise<void>;
  readonly rpush: (key: string, value: string) => Promise<void>;
  readonly lrange: (key: string, start: number, stop: number) => Promise<readonly string[]>;
  readonly ltrim: (key: string, start: number, stop: number) => Promise<void>;
  readonly zadd: (key: string, score: number, member: string) => Promise<void>;
  readonly zrange: (key: string, start: number, stop: number) => Promise<readonly string[]>;
  readonly zrangebyscore: (key: string, min: number, max: number) => Promise<readonly string[]>;
  readonly zrem: (key: string, member: string) => Promise<void>;
}

interface ZEntry {
  readonly member: string;
  readonly score: number;
}

/** Redis-style inclusive range with negative-index support. */
const sliceRange = <T>(items: readonly T[], start: number, stop: number): readonly T[] => {
  const len = items.length;
  const from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  const to = stop < 0 ? len + stop : Math.min(stop, len - 1);
  if (from > to) {
    return [];
  }
  return items.slice(from, to + 1);
};

export function createMemoryKv(): Kv {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, ZEntry[]>();

  return Object.freeze({
    get: async (key: string) => strings.get(key),

    set: async (key: string, value: string) => {
      strings.set(key, value);
    },

    del: async (keys: readonly string[]) => {
      for (const key of keys) {
        strings.delete(key);
        lists.delete(key);
        zsets.delete(key);
      }
    },

    rpush: async (key: string, value: string) => {
      const list = lists.get(key) ?? [];
      lists.set(key, [...list, value]);
    },

    lrange: async (key: string, start: number, stop: number) =>
      sliceRange(lists.get(key) ?? [], start, stop),

    ltrim: async (key: string, start: number, stop: number) => {
      lists.set(key, [...sliceRange(lists.get(key) ?? [], start, stop)]);
    },

    zadd: async (key: string, score: number, member: string) => {
      const entries = (zsets.get(key) ?? []).filter((e) => e.member !== member);
      const next = [...entries, { member, score }].sort(
        (a, b) => a.score - b.score || a.member.localeCompare(b.member)
      );
      zsets.set(key, next);
    },

    zrange: async (key: string, start: number, stop: number) =>
      sliceRange(zsets.get(key) ?? [], start, stop).map((e) => e.member),

    zrangebyscore: async (key: string, min: number, max: number) =>
      (zsets.get(key) ?? []).filter((e) => e.score >= min && e.score <= max).map((e) => e.member),

    zrem: async (key: string, member: string) => {
      zsets.set(
        key,
        (zsets.get(key) ?? []).filter((e) => e.member !== member)
      );
    }
  });
}
