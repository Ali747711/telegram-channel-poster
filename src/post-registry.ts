export type PostKind = 'text' | 'photo' | 'video';

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
  readonly record: (input: PostRecordInput) => void;
  readonly markEdited: (messageId: number, content: string) => void;
  readonly markDeleted: (messageId: number) => void;
  readonly get: (messageId: number) => PostRecord | undefined;
  readonly list: (limit: number) => readonly PostRecord[];
}

const DEFAULT_MAX_ENTRIES = 200;

/**
 * In-memory record of posts made through this server. The Bot API cannot
 * fetch arbitrary messages, so this is the only way to answer "what did we
 * post". State is per-process: it resets when the server restarts (the free
 * Render tier sleeps after idle) — tools must present it as best-effort.
 */
export function createPostRegistry(maxEntries = DEFAULT_MAX_ENTRIES): PostRegistry {
  // Map preserves insertion order, so the first key is always the oldest post.
  const posts = new Map<number, PostRecord>();

  const update = (messageId: number, patch: Partial<PostRecord>): void => {
    const existing = posts.get(messageId);
    if (existing !== undefined) {
      posts.set(messageId, { ...existing, ...patch });
    }
  };

  return Object.freeze({
    record: (input: PostRecordInput): void => {
      posts.set(input.messageId, { ...input, postedAt: new Date().toISOString() });
      while (posts.size > maxEntries) {
        const oldest = posts.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        posts.delete(oldest);
      }
    },

    markEdited: (messageId: number, content: string): void => {
      update(messageId, { content, editedAt: new Date().toISOString() });
    },

    markDeleted: (messageId: number): void => {
      update(messageId, { deletedAt: new Date().toISOString() });
    },

    get: (messageId: number): PostRecord | undefined => posts.get(messageId),

    list: (limit: number): readonly PostRecord[] => [...posts.values()].slice(-limit).reverse()
  });
}
