import type { Kv } from './storage/kv.js';

export type PostKind = 'text' | 'photo' | 'video' | 'document' | 'album' | 'poll';

export interface PostRecordInput {
  readonly messageId: number;
  readonly kind: PostKind;
  readonly content: string;
  readonly link?: string;
}

export interface PostRecord extends PostRecordInput {
  readonly postedAt: string;
  readonly editedAt?: string;
  readonly deletedAt?: string;
}

export interface PostRegistry {
  readonly record: (input: PostRecordInput) => Promise<void>;
  readonly markEdited: (messageId: number, content: string) => Promise<void>;
  readonly markDeleted: (messageId: number) => Promise<void>;
  readonly get: (messageId: number) => Promise<PostRecord | undefined>;
  readonly list: (limit: number) => Promise<readonly PostRecord[]>;
}

const DEFAULT_MAX_ENTRIES = 500;
const INDEX_KEY = 'posts:index';
const postKey = (messageId: number | string): string => `post:${messageId}`;

/**
 * Record of posts made through this server, on top of the Kv abstraction:
 * persistent when backed by Upstash Redis, per-process when in-memory.
 * The Bot API cannot fetch arbitrary messages, so this is the only way to
 * answer "what did we post".
 */
export function createPostRegistry(kv: Kv, maxEntries = DEFAULT_MAX_ENTRIES): PostRegistry {
  const read = async (messageId: number): Promise<PostRecord | undefined> => {
    const raw = await kv.get(postKey(messageId));
    return raw === undefined ? undefined : (JSON.parse(raw) as PostRecord);
  };

  const update = async (messageId: number, patch: Partial<PostRecord>): Promise<void> => {
    const existing = await read(messageId);
    if (existing !== undefined) {
      await kv.set(postKey(messageId), JSON.stringify({ ...existing, ...patch }));
    }
  };

  return Object.freeze({
    record: async (input: PostRecordInput): Promise<void> => {
      const record: PostRecord = { ...input, postedAt: new Date().toISOString() };
      await kv.set(postKey(input.messageId), JSON.stringify(record));
      await kv.rpush(INDEX_KEY, String(input.messageId));

      const evicted = await kv.lrange(INDEX_KEY, 0, -(maxEntries + 1));
      if (evicted.length > 0) {
        await kv.del(evicted.map(postKey));
        await kv.ltrim(INDEX_KEY, -maxEntries, -1);
      }
    },

    markEdited: (messageId: number, content: string) =>
      update(messageId, { content, editedAt: new Date().toISOString() }),

    markDeleted: (messageId: number) => update(messageId, { deletedAt: new Date().toISOString() }),

    get: read,

    list: async (limit: number): Promise<readonly PostRecord[]> => {
      const ids = await kv.lrange(INDEX_KEY, -limit, -1);
      const records = await Promise.all(ids.map((id) => kv.get(postKey(id))));
      return records
        .filter((raw): raw is string => raw !== undefined)
        .map((raw) => JSON.parse(raw) as PostRecord)
        .reverse();
    }
  });
}
