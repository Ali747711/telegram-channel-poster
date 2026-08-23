import { describe, expect, it } from 'vitest';

import { createScheduleStore, type ScheduledPost } from '../src/schedule-store.js';
import { createMemoryKv } from '../src/storage/kv.js';

const entry = (id: string, publishAtMs: number): ScheduledPost => ({
  id,
  text: `post ${id}`,
  disableLinkPreview: true,
  silent: false,
  publishAtMs,
  createdAt: new Date(0).toISOString()
});

describe('createScheduleStore', () => {
  it('adds entries and lists them ordered by publish time', async () => {
    const store = createScheduleStore(createMemoryKv());
    await store.add(entry('b', 2000));
    await store.add(entry('a', 1000));

    const all = await store.list();

    expect(all.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('returns only due entries', async () => {
    const store = createScheduleStore(createMemoryKv());
    await store.add(entry('past', 1000));
    await store.add(entry('future', 99_000));

    const due = await store.due(50_000);

    expect(due.map((s) => s.id)).toEqual(['past']);
  });

  it('removes entries completely', async () => {
    const store = createScheduleStore(createMemoryKv());
    await store.add(entry('x', 1000));

    await store.remove('x');

    expect(await store.list()).toEqual([]);
    expect(await store.due(99_999)).toEqual([]);
  });
});
