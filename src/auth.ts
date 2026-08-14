import { createHash, timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';

/** RFC 6750 syntax: "Bearer" (case-insensitive scheme) followed by the token. */
const BEARER_PATTERN = /^Bearer +(\S+)$/i;

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time bearer-token gate for the /mcp endpoint.
 * Tokens are compared as SHA-256 digests so timingSafeEqual always gets
 * equal-length buffers and comparison time never depends on the token value.
 * The presented token is never logged or echoed back.
 */
export function requireBearerAuth(expectedToken: string): RequestHandler {
  const expectedDigest = sha256(expectedToken);

  return (req, res, next) => {
    const header = req.get('authorization');
    const match = header === undefined ? null : BEARER_PATTERN.exec(header);

    if (match?.[1] !== undefined && timingSafeEqual(sha256(match[1]), expectedDigest)) {
      next();
      return;
    }

    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer error="invalid_token"')
      .json({ error: 'unauthorized' });
  };
}
