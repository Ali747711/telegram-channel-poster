import 'dotenv/config';

import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createFileStore } from './file-store.js';
import { createPostRegistry } from './post-registry.js';
import { createScheduleStore } from './schedule-store.js';
import { startScheduler } from './scheduler.js';
import { createMemoryKv } from './storage/kv.js';
import { createUpstashKv } from './storage/upstash.js';
import { createTelegramClient } from './telegram/client.js';
import { createLogger } from './utils/logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

function readConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return process.exit(1);
  }
}

function main(): void {
  const config = readConfigOrExit();
  const logger = createLogger(config.logLevel);
  const telegram = createTelegramClient({ botToken: config.botToken });

  const persistent = config.upstash !== undefined;
  const kv = persistent
    ? createUpstashKv(config.upstash!.url, config.upstash!.token)
    : createMemoryKv();
  const registry = createPostRegistry(kv);
  const schedule = createScheduleStore(kv);
  const files = createFileStore();
  logger.info('storage initialized', { mode: persistent ? 'upstash-redis' : 'in-memory' });

  const app = buildApp({
    mcpAuthToken: config.mcpAuthToken,
    logger,
    telegram,
    channelId: config.channelId,
    registry,
    schedule,
    files,
    persistent
  });

  const scheduler = startScheduler({ schedule, registry, telegram, channelId: config.channelId, logger });

  // Bind 0.0.0.0 so the server is reachable inside Render's container network.
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server listening', { port: config.port });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
