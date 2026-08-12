/**
 * Browser-side API client.
 *
 * Unwraps the `{ error: { code, message, requestId } }` envelope the route
 * wrapper produces, so UI code catches a typed error instead of inspecting
 * response shapes at every call site.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Extra headers, merged in after Content-Type. Only the widget needs this
   * today — it authenticates with a bearer token instead of the session
   * cookie every other caller relies on.
   */
  headers?: Record<string, string>;
};

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal, headers } = options;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      // Session cookie travels with every call; the server checks Origin.
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Offline, DNS failure, connection reset — the user needs a human message,
    // not "Failed to fetch".
    throw new ApiError(
      'NETWORK',
      "Couldn't reach the server. Check your connection and try again.",
      0,
    );
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (payload as { error?: { code: string; message: string; requestId?: string } })
      ?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL',
      err?.message ?? 'Something went wrong',
      res.status,
      err?.requestId,
    );
  }

  return payload as T;
}
