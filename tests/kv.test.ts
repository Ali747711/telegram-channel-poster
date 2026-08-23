import { describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from '../src/storage/kv.js';
import { createUpstashKv } from '../src/storage/upstash.js';

describe('createMemoryKv', () => {
  it('sets, gets and deletes string values', async () => {
    const kv = createMemoryKv();

    await kv.set('a', '1');
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('missing')).toBeUndefined();

    await kv.del(['a']);
    expect(await kv.get('a')).toBeUndefined();
  });

  it('supports list push, range with negative indices, and trim', async () => {
    const kv = createMemoryKv();
    for (const v of ['1', '2', '3', '4', '5']) {
      await kv.rpush('l', v);
    }

    expect(await kv.lrange('l', 0, -1)).toEqual(['1', '2', '3', '4', '5']);
    expect(await kv.lrange('l', -2, -1)).toEqual(['4', '5']);
    expect(await kv.lrange('l', 0, -4)).toEqual(['1', '2']);
    expect(await kv.lrange('l', 3, 1)).toEqual([]);

    await kv.ltrim('l', -2, -1);
    expect(await kv.lrange('l', 0, -1)).toEqual(['4', '5']);
  });

  it('supports sorted sets ordered by score', async () => {
    const kv = createMemoryKv();
    await kv.zadd('z', 30, 'c');
    await kv.zadd('z', 10, 'a');
    await kv.zadd('z', 20, 'b');

    expect(await kv.zrange('z', 0, -1)).toEqual(['a', 'b', 'c']);
    expect(await kv.zrangebyscore('z', 0, 20)).toEqual(['a', 'b']);

    await kv.zadd('z', 5, 'c'); // re-add updates score
    expect(await kv.zrange('z', 0, -1)).toEqual(['c', 'a', 'b']);

    await kv.zrem('z', 'a');
    expect(await kv.zrange('z', 0, -1)).toEqual(['c', 'b']);
  });
});

describe('createUpstashKv', () => {
  const mockFetch = (result: unknown) =>
    vi.fn(async () => new Response(JSON.stringify({ result }), { status: 200 }));

  it('sends single Redis commands with the bearer token', async () => {
    const fetchFn = mockFetch('OK');
    const kv = createUpstashKv('https://fake.upstash.io', 'tok-123', fetchFn);

    await kv.set('key', 'value');

    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://fake.upstash.io');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(String(init.body))).toEqual(['SET', 'key', 'value']);
  });

  it('parses results and maps null to undefined', async () => {
    const kv = createUpstashKv('https://fake.upstash.io', 't', mockFetch(null));

    expect(await kv.get('missing')).toBeUndefined();
  });

  it('returns arrays for range commands', async () => {
    const fetchFn = mockFetch(['a', 'b']);
    const kv = createUpstashKv('https://fake.upstash.io', 't', fetchFn);

    expect(await kv.zrangebyscore('z', 0, 99)).toEqual(['a', 'b']);
    expect(JSON.parse(String((fetchFn.mock.calls[0]! as unknown as [string, RequestInit])[1].body))).toEqual([
      'ZRANGEBYSCORE',
      'z',
      '0',
      '99'
    ]);
  });

  it('throws a clear error on an Upstash error response', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 }));
    const kv = createUpstashKv('https://fake.upstash.io', 'bad', fetchFn);

    await expect(kv.get('k')).rejects.toThrow(/upstash.*GET/i);
  });
});
