import { z } from 'zod';

import { LOG_LEVELS, type LogLevel } from './utils/logger.js';

export interface Config {
  readonly botToken: string;
  readonly channelId: string;
  readonly mcpAuthToken: string;
  readonly port: number;
  readonly logLevel: LogLevel;
}

/** "@channelusername" (5+ chars after @) or a numeric chat ID like "-1001234567890". */
const CHANNEL_ID_PATTERN = /^(@[A-Za-z][A-Za-z0-9_]{4,}|-?\d+)$/;

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ required_error: 'required — create a bot via @BotFather to get it' })
    .min(1, 'must not be empty'),
  TELEGRAM_CHANNEL_ID: z
    .string({ required_error: 'required — "@channelusername" or a numeric chat ID' })
    .regex(CHANNEL_ID_PATTERN, 'must be "@channelusername" or a numeric chat ID like "-1001234567890"'),
  MCP_AUTH_TOKEN: z
    .string({ required_error: 'required — generate with `openssl rand -hex 32`' })
    .min(32, 'must be at least 32 characters — generate with `openssl rand -hex 32`'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info')
});

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');

/**
 * Loads and validates configuration from environment variables.
 * Throws with a message naming every invalid/missing variable (never their values),
 * so the server fails fast at startup instead of failing on the first post.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error)}`);
  }

  return Object.freeze({
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    channelId: parsed.data.TELEGRAM_CHANNEL_ID,
    mcpAuthToken: parsed.data.MCP_AUTH_TOKEN,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL
  });
}
