import { describe, expect, it } from 'vitest';

import { createDmGuard, DM_DAILY_LIMIT } from '../src/telegram/dm-guard.js';
import { createMemoryKv } from '../src/storage/kv.js';

const guard = (nowFn?: () => number) => createDmGuard(createMemoryKv(), nowFn);

describe('createDmGuard', () => {
  it('allows sends below the daily limit and reports the remaining budget', async () => {
    const g = guard();

    const check = await g.check();

    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(DM_DAILY_LIMIT);
  });

  it('counts each recorded send against the day budget', async () => {
    const g = guard();

    await g.record();
    await g.record();

    expect((await g.check()).remaining).toBe(DM_DAILY_LIMIT - 2);
  });

  it('blocks once the daily limit is reached', async () => {
    const g = guard();
    for (let i = 0; i < DM_DAILY_LIMIT; i += 1) {
      await g.record();
    }

    const check = await g.check();

    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
  });

  it('resets the budget on a new calendar day', async () => {
    let now = Date.parse('2026-08-24T12:00:00Z');
    const g = guard(() => now);
    for (let i = 0; i < DM_DAILY_LIMIT; i += 1) {
      await g.record();
    }
    expect((await g.check()).allowed).toBe(false);

    now = Date.parse('2026-08-25T00:30:00Z');

    expect((await g.check()).allowed).toBe(true);
  });
});
