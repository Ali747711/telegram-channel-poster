import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createLogger } from '../src/utils/logger.js';

describe('createLogger', () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const lastLine = (spy: MockInstance): Record<string, unknown> => {
    const call = spy.mock.calls.at(-1);
    expect(call).toBeDefined();
    return JSON.parse(String(call![0])) as Record<string, unknown>;
  };

  it('writes info logs to stdout as JSON lines with level, message and timestamp', () => {
    const logger = createLogger('info');

    logger.info('server started');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const entry = lastLine(stdoutSpy);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('server started');
    expect(typeof entry.time).toBe('string');
  });

  it('suppresses debug logs when level is info', () => {
    const logger = createLogger('info');

    logger.debug('noisy detail');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits debug logs when level is debug', () => {
    const logger = createLogger('debug');

    logger.debug('noisy detail');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(lastLine(stdoutSpy).level).toBe('debug');
  });

  it('writes warn and error logs to stderr', () => {
    const logger = createLogger('info');

    logger.warn('something odd');
    logger.error('something broke');

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(lastLine(stderrSpy).level).toBe('error');
  });

  it('suppresses info and warn when level is error', () => {
    const logger = createLogger('error');

    logger.info('hello');
    logger.warn('careful');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('merges structured context into the log entry', () => {
    const logger = createLogger('info');

    logger.info('listening', { port: 3000 });

    expect(lastLine(stdoutSpy).port).toBe(3000);
  });

  it('falls back to a minimal entry when context is not serializable', () => {
    const logger = createLogger('info');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info('kept anyway', { circular });

    const entry = lastLine(stdoutSpy);
    expect(entry.msg).toBe('kept anyway');
    expect(entry.logError).toBe('context was not serializable');
  });

  it('does not let context overwrite the reserved level/msg/time fields', () => {
    const logger = createLogger('info');

    logger.info('real message', { msg: 'spoofed', level: 'error' });

    const entry = lastLine(stdoutSpy);
    expect(entry.msg).toBe('real message');
    expect(entry.level).toBe('info');
  });
});
