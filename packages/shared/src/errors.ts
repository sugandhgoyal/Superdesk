/**
 * Error taxonomy.
 *
 * Two rules this exists to enforce:
 *   1. Clients get a stable `code` they can branch on, never a raw stack.
 *   2. Anything not explicitly modelled here becomes a generic 500 with a
 *      correlation id — no ORM messages, constraint names, or file paths leak
 *      to the browser.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Safe to render in the UI. */
  readonly publicMessage: string;
  /** Extra context for logs only — never serialized to the client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    publicMessage: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(publicMessage, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.publicMessage = publicMessage;
    this.context = options?.context;
  }
}

export const badRequest = (msg = 'Invalid request', ctx?: Record<string, unknown>) =>
  new AppError('BAD_REQUEST', msg, { context: ctx });
export const unauthenticated = (msg = 'You need to sign in') =>
  new AppError('UNAUTHENTICATED', msg);
export const forbidden = (msg = "You don't have access to that") =>
  new AppError('FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new AppError('NOT_FOUND', msg);
export const conflict = (msg = 'That already exists') =>
  new AppError('CONFLICT', msg);
export const rateLimited = (msg = 'Too many requests — slow down') =>
  new AppError('RATE_LIMITED', msg);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
