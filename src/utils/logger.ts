export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogContext {
  readonly [key: string]: unknown;
}

export interface Logger {
  readonly debug: (message: string, context?: LogContext) => void;
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, context?: LogContext) => void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const serialize = (entry: Record<string, unknown>): string => {
  try {
    return JSON.stringify(entry);
  } catch {
    // Context contained something unserializable (e.g. circular refs);
    // keep the reserved fields rather than losing the log line entirely.
    return JSON.stringify({
      level: entry.level,
      msg: entry.msg,
      time: entry.time,
      logError: 'context was not serializable'
    });
  }
};

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const emit = (entryLevel: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) {
      return;
    }
    // Reserved fields are spread last so context cannot spoof them.
    const entry = {
      ...context,
      level: entryLevel,
      msg: message,
      time: new Date().toISOString()
    };
    const stream = entryLevel === 'warn' || entryLevel === 'error' ? process.stderr : process.stdout;
    stream.write(`${serialize(entry)}\n`);
  };

  return Object.freeze({
    debug: (message: string, context?: LogContext) => emit('debug', message, context),
    info: (message: string, context?: LogContext) => emit('info', message, context),
    warn: (message: string, context?: LogContext) => emit('warn', message, context),
    error: (message: string, context?: LogContext) => emit('error', message, context)
  });
}
