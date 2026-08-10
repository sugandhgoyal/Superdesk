/**
 * Structured logging.
 *
 * One JSON object per line so Vercel/Railway log search actually works, with a
 * `requestId` threaded through a request's whole life — including into the
 * queue jobs it enqueues — so a failure can be traced end to end.
 *
 * Deliberately dependency-free: pino pulls in transports and worker threads
 * that misbehave in serverless runtimes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/** Keys whose values are replaced with [redacted] wherever they appear. */
const REDACT = new Set([
  'password',
  'passwordHash',
  'token',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.has(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

export type LogContext = Record<string, unknown>;

export class Logger {
  constructor(private readonly base: LogContext = {}) {}

  /** Returns a logger that stamps every line with additional context. */
  child(context: LogContext): Logger {
    return new Logger({ ...this.base, ...context });
  }

  private emit(level: LogLevel, message: string, context?: LogContext) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const line = {
      level,
      time: new Date().toISOString(),
      message,
      ...(sanitize({ ...this.base, ...context }) as LogContext),
    };

    const serialized = JSON.stringify(line);
    if (level === 'error') console.error(serialized);
    else if (level === 'warn') console.warn(serialized);
    else console.log(serialized);
  }

  debug = (message: string, context?: LogContext) =>
    this.emit('debug', message, context);
  info = (message: string, context?: LogContext) =>
    this.emit('info', message, context);
  warn = (message: string, context?: LogContext) =>
    this.emit('warn', message, context);

  error(message: string, err?: unknown, context?: LogContext) {
    this.emit('error', message, {
      ...context,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : err,
    });
  }
}

export const logger = new Logger({ service: process.env.SERVICE_NAME ?? 'web' });

export function newRequestId(): string {
  return crypto.randomUUID();
}
