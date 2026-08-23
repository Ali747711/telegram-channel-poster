import { describe, expect, it } from 'vitest';

import { createFileStore } from '../src/file-store.js';

describe('createFileStore', () => {
  it('stores a file and returns it by id', () => {
    const store = createFileStore();

    const id = store.put({ data: Buffer.from('hello'), filename: 'a.txt', contentType: 'text/plain' });
    const file = store.get(id);

    expect(file?.filename).toBe('a.txt');
    expect(file?.data.toString()).toBe('hello');
    expect(store.get('nope')).toBeUndefined();
  });

  it('expires files after the TTL', () => {
    let now = 1_000_000;
    const store = createFileStore({ ttlMs: 60_000, nowFn: () => now });
    const id = store.put({ data: Buffer.from('x'), filename: 'x.bin', contentType: 'application/octet-stream' });

    now += 59_000;
    expect(store.get(id)).toBeDefined();

    now += 2_000;
    expect(store.get(id)).toBeUndefined();
  });

  it('rejects a file over the per-file limit', () => {
    const store = createFileStore({ maxFileBytes: 10 });

    expect(() =>
      store.put({ data: Buffer.alloc(11), filename: 'big.bin', contentType: 'application/octet-stream' })
    ).toThrow(/too large/i);
  });

  it('rejects when the total budget is exhausted by unexpired files', () => {
    const store = createFileStore({ maxFileBytes: 10, maxTotalBytes: 15 });
    store.put({ data: Buffer.alloc(10), filename: 'a', contentType: 'x' });

    expect(() => store.put({ data: Buffer.alloc(10), filename: 'b', contentType: 'x' })).toThrow(
      /storage full/i
    );
  });
});
