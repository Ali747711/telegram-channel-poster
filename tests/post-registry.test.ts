import { describe, expect, it } from 'vitest';

import { createPostRegistry } from '../src/post-registry.js';
import { createMemoryKv } from '../src/storage/kv.js';

const registry = (max?: number) => createPostRegistry(createMemoryKv(), max);

describe('createPostRegistry', () => {
  it('records posts and returns them by message ID', async () => {
    const r = registry();

    await r.record({ messageId: 1, kind: 'text', content: 'hello', link: 'https://t.me/c/1' });

    const post = await r.get(1);
    expect(post?.content).toBe('hello');
    expect(post?.kind).toBe('text');
    expect(typeof post?.postedAt).toBe('string');
    expect(post?.editedAt).toBeUndefined();
  });

  it('returns undefined for unknown message IDs', async () => {
    expect(await registry().get(999)).toBeUndefined();
  });

  it('lists posts newest first with a limit', async () => {
    const r = registry();
    await r.record({ messageId: 1, kind: 'text', content: 'first' });
    await r.record({ messageId: 2, kind: 'photo', content: 'second' });
    await r.record({ messageId: 3, kind: 'poll', content: 'third' });

    const posts = await r.list(2);

    expect(posts.map((p) => p.messageId)).toEqual([3, 2]);
  });

  it('marks posts edited with the new content', async () => {
    const r = registry();
    await r.record({ messageId: 1, kind: 'text', content: 'old' });

    await r.markEdited(1, 'new');

    const post = await r.get(1);
    expect(post?.content).toBe('new');
    expect(typeof post?.editedAt).toBe('string');
  });

  it('marks posts deleted but keeps the record', async () => {
    const r = registry();
    await r.record({ messageId: 1, kind: 'text', content: 'gone soon' });

    await r.markDeleted(1);

    expect(typeof (await r.get(1))?.deletedAt).toBe('string');
  });

  it('evicts the oldest records past the cap, including their blobs', async () => {
    const r = registry(3);
    for (let id = 1; id <= 5; id += 1) {
      await r.record({ messageId: id, kind: 'text', content: `post ${id}` });
    }

    expect(await r.get(1)).toBeUndefined();
    expect(await r.get(2)).toBeUndefined();
    expect((await r.get(5))?.content).toBe('post 5');
    expect(await r.list(10)).toHaveLength(3);
  });
});
