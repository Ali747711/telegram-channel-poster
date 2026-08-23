import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const validEnv = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  TELEGRAM_CHANNEL_ID: '@my_channel',
  MCP_AUTH_TOKEN: 'f'.repeat(64)
};

describe('loadConfig', () => {
  it('returns a config with defaults applied when optional vars are absent', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      botToken: validEnv.TELEGRAM_BOT_TOKEN,
      channelId: '@my_channel',
      mcpAuthToken: validEnv.MCP_AUTH_TOKEN,
      port: 3000,
      logLevel: 'info'
    });
  });

  it('coerces PORT from string and accepts a custom LOG_LEVEL', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080', LOG_LEVEL: 'debug' });

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
  });

  it('accepts a numeric channel ID (private channel form)', () => {
    const config = loadConfig({ ...validEnv, TELEGRAM_CHANNEL_ID: '-1001234567890' });

    expect(config.channelId).toBe('-1001234567890');
  });

  it('rejects a channel ID that is neither @username nor numeric', () => {
    expect(() => loadConfig({ ...validEnv, TELEGRAM_CHANNEL_ID: 'my_channel' })).toThrow(
      /TELEGRAM_CHANNEL_ID/
    );
  });

  it('lists every missing required variable in the error message', () => {
    expect(() => loadConfig({})).toThrow(
      /TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_CHANNEL_ID[\s\S]*MCP_AUTH_TOKEN/
    );
  });

  it('rejects an MCP_AUTH_TOKEN shorter than 32 chars and explains how to generate one', () => {
    expect(() => loadConfig({ ...validEnv, MCP_AUTH_TOKEN: 'shorttoken' })).toThrow(
      /MCP_AUTH_TOKEN[\s\S]*openssl rand/
    );
  });

  it('never includes secret values in validation errors', () => {
    const secret = 'super-secret-but-too-short';

    try {
      loadConfig({ ...validEnv, MCP_AUTH_TOKEN: secret });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('returns no upstash config when the variables are absent', () => {
    expect(loadConfig(validEnv).upstash).toBeUndefined();
  });

  it('returns upstash config when both REST variables are set', () => {
    const config = loadConfig({
      ...validEnv,
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok'
    });

    expect(config.upstash).toEqual({ url: 'https://x.upstash.io', token: 'tok' });
  });

  it('rejects a lone upstash variable (must be both or neither)', () => {
    expect(() => loadConfig({ ...validEnv, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toThrow(
      /UPSTASH/
    );
  });

  it('returns a frozen (immutable) config object', () => {
    const config = loadConfig(validEnv);

    expect(Object.isFrozen(config)).toBe(true);
  });

  it('ignores unrelated environment variables', () => {
    const config = loadConfig({ ...validEnv, HOME: '/Users/nobody', NODE_ENV: 'test' });

    expect(config).not.toHaveProperty('HOME');
    expect(config).not.toHaveProperty('NODE_ENV');
  });
});
