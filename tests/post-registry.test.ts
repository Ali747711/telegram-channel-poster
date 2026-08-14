import { describe, expect, it } from 'vitest';

import { createPostRegistry } from '../src/post-registry.js';

describe('createPostRegistry', () => {
  it('records posts and returns them by message ID', () => {
    const registry = createPostRegistry();

    registry.record({ messageId: 1, kind: 'text', content: 'hello', link: 'https://t.me/c/1' });

    const post = registry.get(1);
    expect(post?.content).toBe('hello');
    expect(post?.kind).toBe('text');
    expect(typeof post?.postedAt).toBe('string');
    expect(post?.editedAt).toBeUndefined();
  });

  it('returns undefined for unknown message IDs', () => {
    const registry = createPostRegistry();

    expect(registry.get(999)).toBeUndefined();
  });

  it('lists posts newest first with a limit', () => {
    const registry = createPostRegistry();
    registry.record({ messageId: 1, kind: 'text', content: 'first' });
    registry.record({ messageId: 2, kind: 'photo', content: 'second' });
    registry.record({ messageId: 3, kind: 'text', content: 'third' });

    const posts = registry.list(2);

    expect(posts.map((p) => p.messageId)).toEqual([3, 2]);
  });

  it('marks posts edited with the new content', () => {
    const registry = createPostRegistry();
    registry.record({ messageId: 1, kind: 'text', content: 'old' });

    registry.markEdited(1, 'new');

    const post = registry.get(1);
    expect(post?.content).toBe('new');
    expect(typeof post?.editedAt).toBe('string');
  });

  it('marks posts deleted but keeps the record', () => {
    const registry = createPostRegistry();
    registry.record({ messageId: 1, kind: 'text', content: 'gone soon' });

    registry.markDeleted(1);

    expect(typeof registry.get(1)?.deletedAt).toBe('string');
  });

  it('evicts the oldest records past the cap', () => {
    const registry = createPostRegistry(3);
    for (let id = 1; id <= 5; id += 1) {
      registry.record({ messageId: id, kind: 'text', content: `post ${id}` });
    }

    expect(registry.get(1)).toBeUndefined();
    expect(registry.get(2)).toBeUndefined();
    expect(registry.get(5)?.content).toBe('post 5');
    expect(registry.list(10)).toHaveLength(3);
  });
});
