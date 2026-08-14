import type { RequestHandler } from 'express';

import type { Logger } from './utils/logger.js';

/**
 * Logs one line per request when the response finishes.
 * Deliberately logs ONLY method, path, status and duration —
 * never headers (Authorization!) and never bodies (post content).
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = performance.now();

    res.on('finish', () => {
      logger.info('http request', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt)
      });
    });

    next();
  };
}
