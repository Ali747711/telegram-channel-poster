import { createHash, timingSafeEqual } from 'node:crypto';

import type { Request, RequestHandler } from 'express';

/** RFC 6750 syntax: "Bearer" (case-insensitive scheme) followed by the token. */
const BEARER_PATTERN = /^Bearer +(\S+)$/i;

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Token can arrive as "Authorization: Bearer <token>" (Claude Code) or as a
 * ?token= query parameter (claude.ai custom connectors, which cannot set
 * custom headers). The request logger strips query strings, so the query
 * variant never reaches our logs.
 */
const presentedToken = (req: Request): string | undefined => {
  const header = req.get('authorization');
  const match = header === undefined ? null : BEARER_PATTERN.exec(header);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  const query = req.query.token;
  return typeof query === 'string' && query.length > 0 ? query : undefined;
};

/**
 * Constant-time token gate for the /mcp endpoint.
 * Tokens are compared as SHA-256 digests so timingSafeEqual always gets
 * equal-length buffers and comparison time never depends on the token value.
 * The presented token is never logged or echoed back.
 */
export function requireBearerAuth(expectedToken: string): RequestHandler {
  const expectedDigest = sha256(expectedToken);

  return (req, res, next) => {
    const token = presentedToken(req);

    if (token !== undefined && timingSafeEqual(sha256(token), expectedDigest)) {
      next();
      return;
    }

    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer error="invalid_token"')
      .json({ error: 'unauthorized' });
  };
}
