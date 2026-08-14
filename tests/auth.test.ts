import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { requireBearerAuth } from '../src/auth.js';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';

const buildProtectedApp = (): Express => {
  const app = express();
  app.post('/protected', requireBearerAuth(TOKEN), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

describe('requireBearerAuth', () => {
  it('rejects requests without an Authorization header with 401 + WWW-Authenticate', async () => {
    const res = await request(buildProtectedApp()).post('/protected');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', `Basic ${TOKEN}`);

    expect(res.status).toBe(401);
  });

  it('rejects a wrong token of the same length', async () => {
    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', `Bearer ${'z'.repeat(TOKEN.length)}`);

    expect(res.status).toBe(401);
  });

  it('rejects a wrong token of a different length', async () => {
    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', 'Bearer short');

    expect(res.status).toBe(401);
  });

  it('rejects an empty token', async () => {
    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });

  it('accepts the correct token', async () => {
    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('treats the Bearer scheme as case-insensitive but the token as case-sensitive', async () => {
    const app = buildProtectedApp();

    const okRes = await request(app).post('/protected').set('Authorization', `bearer ${TOKEN}`);
    const badRes = await request(app)
      .post('/protected')
      .set('Authorization', `Bearer ${TOKEN.toUpperCase()}`);

    expect(okRes.status).toBe(200);
    expect(badRes.status).toBe(401);
  });

  describe('query-parameter token (for clients that cannot set headers, e.g. claude.ai connectors)', () => {
    it('accepts the correct token via ?token=', async () => {
      const res = await request(buildProtectedApp()).post(`/protected?token=${TOKEN}`);

      expect(res.status).toBe(200);
    });

    it('rejects a wrong query token', async () => {
      const res = await request(buildProtectedApp()).post(`/protected?token=${'z'.repeat(TOKEN.length)}`);

      expect(res.status).toBe(401);
    });

    it('rejects an empty query token', async () => {
      const res = await request(buildProtectedApp()).post('/protected?token=');

      expect(res.status).toBe(401);
    });

    it('prefers a valid header even when a bogus query token is present', async () => {
      const res = await request(buildProtectedApp())
        .post('/protected?token=wrong')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(200);
    });
  });

  it('never echoes the presented token in the 401 response', async () => {
    const presented = 'attacker-supplied-token-value-123456';

    const res = await request(buildProtectedApp())
      .post('/protected')
      .set('Authorization', `Bearer ${presented}`);

    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(presented);
    expect(res.headers['www-authenticate'] ?? '').not.toContain(presented);
  });
});
