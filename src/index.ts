import 'dotenv/config';

import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
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
  const app = buildApp({
    mcpAuthToken: config.mcpAuthToken,
    logger,
    telegram,
    channelId: config.channelId
  });

  // Bind 0.0.0.0 so the server is reachable inside Render's container network.
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server listening', { port: config.port });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
