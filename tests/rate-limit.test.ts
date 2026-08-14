import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { rateLimit } from '../src/rate-limit.js';

const WINDOW_MS = 60_000;
const MAX = 5;

const buildLimitedApp = (nowFn?: () => number): Express => {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/limited', rateLimit({ windowMs: WINDOW_MS, max: MAX, nowFn }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

describe('rateLimit', () => {
  it('allows up to max requests within the window', async () => {
    const app = buildLimitedApp();

    for (let i = 0; i < MAX; i += 1) {
      const res = await request(app).post('/limited');
      expect(res.status).toBe(200);
    }
  });

  it('rejects the request after the limit with 429 and a Retry-After header', async () => {
    const app = buildLimitedApp();

    for (let i = 0; i < MAX; i += 1) {
      await request(app).post('/limited');
    }
    const res = await request(app).post('/limited');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('tracks different client IPs in separate buckets', async () => {
    const app = buildLimitedApp();

    for (let i = 0; i < MAX; i += 1) {
      await request(app).post('/limited').set('X-Forwarded-For', '10.0.0.1');
    }
    const blocked = await request(app).post('/limited').set('X-Forwarded-For', '10.0.0.1');
    const other = await request(app).post('/limited').set('X-Forwarded-For', '10.0.0.2');

    expect(blocked.status).toBe(429);
    expect(other.status).toBe(200);
  });

  it('frees the bucket once the window has passed', async () => {
    let now = 1_000_000;
    const app = buildLimitedApp(() => now);

    for (let i = 0; i < MAX; i += 1) {
      await request(app).post('/limited');
    }
    expect((await request(app).post('/limited')).status).toBe(429);

    now += WINDOW_MS + 1;

    expect((await request(app).post('/limited')).status).toBe(200);
  });
});
