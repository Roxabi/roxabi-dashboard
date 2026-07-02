/**
 * api.ts — thin fetch wrapper for the Worker HTTP API.
 *
 * - Same-origin by default (the app is served by the Worker via ASSETS today;
 *   after the app.live cutover the same Worker still owns /api). `VITE_API_BASE`
 *   overrides the base for local dev against a remote Worker.
 * - `credentials: "include"` so the session cookie rides along.
 * - Throws `ApiError` on any non-2xx so TanStack Query surfaces the failure.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Base URL for the Worker API. Empty string = same-origin. */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type QueryValue = string | number | boolean | undefined | null;

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** JSON request body — serialized and Content-Type set automatically. */
  body?: unknown;
  /** Query params appended to the path; undefined/null entries are skipped. */
  query?: Record<string, QueryValue>;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = API_BASE + path;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const init: RequestInit = {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(buildUrl(path, query), init);
  const parsed = await parseBody(res);

  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
    throw new ApiError(res.status, message, parsed, retryAfter);
  }
  return parsed as T;
}

export interface ConditionalFetchResult<T> {
  data: T | null;
  notModified: boolean;
  etag: string | null;
}

/** GET with If-None-Match — returns notModified=true on HTTP 304. */
export async function apiFetchConditional<T>(
  path: string,
  ifNoneMatch?: string | null,
): Promise<ConditionalFetchResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
  const res = await fetch(buildUrl(path), { credentials: "include", headers });
  const etag = res.headers.get("etag");
  if (res.status === 304) {
    return { data: null, notModified: true, etag: etag ?? ifNoneMatch ?? null };
  }
  const parsed = await parseBody(res);
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
    throw new ApiError(res.status, message, parsed, retryAfter);
  }
  return { data: parsed as T, notModified: false, etag };
}
