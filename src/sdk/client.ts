/**
 * CryptohopperClient — the public entry point. Holds the bearer token and exposes
 * namespaced resources (`client.projects.*`, `client.secrets.*`, ...). Tests
 * drive the internal transport via the `__request` escape hatch.
 *
 * Resources are attached in Task 12 — this file sets up the transport and
 * constructor options.
 */

import { CryptohopperError } from "./errors.js";
import { CURRENT_VERSION } from "./version.js";
import { Projects } from "./resources/projects.js";
import { Secrets } from "./resources/secrets.js";
import { ApiKeys } from "./resources/apiKeys.js";
import { Library } from "./resources/library.js";
import { Subdomains } from "./resources/subdomains.js";
import { Uploads } from "./resources/uploads.js";
import { Usage } from "./resources/usage.js";
import { Subscriptions } from "./resources/subscriptions.js";
import { User } from "./resources/user.js";

const DEFAULT_BASE_URL = "https://www.cryptohopper.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface CryptohopperClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Applies to every call; overridable per call. */
  timeoutMs?: number;
  /** Default interval between status polls in waitForLive/stream. */
  pollIntervalMs?: number;
  /** Appended after "cryptohopperai-sdk/<v>" in the User-Agent header. */
  userAgent?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
interface ApiOkBody<T> {
  data: T;
}

export class CryptohopperClient {
  readonly baseUrl: string;
  readonly pollIntervalMs: number;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgentSuffix?: string;

  readonly projects: Projects;
  readonly secrets: Secrets;
  readonly apiKeys: ApiKeys;
  readonly library: Library;
  readonly subdomains: Subdomains;
  readonly uploads: Uploads;
  readonly usage: Usage;
  readonly subscriptions: Subscriptions;
  readonly user: User;

  constructor(opts: CryptohopperClientOptions) {
    if (!opts?.apiKey) {
      throw new TypeError("CryptohopperClient: `apiKey` is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.userAgentSuffix = opts.userAgent;

    this.projects = new Projects(this);
    this.secrets = new Secrets(this);
    this.apiKeys = new ApiKeys(this);
    this.library = new Library(this);
    this.subdomains = new Subdomains(this);
    this.uploads = new Uploads(this);
    this.usage = new Usage(this);
    this.subscriptions = new Subscriptions(this);
    this.user = new User(this);
  }

  /**
   * Internal transport. Not a public API — resources call it, tests use
   * the `__request` alias. Double-underscore prefix discourages importing
   * this directly while keeping it callable without type gymnastics.
   */
  async __request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ua = `cryptohopperai-sdk/${CURRENT_VERSION}${this.userAgentSuffix ? ` ${this.userAgentSuffix}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": ua,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = options.signal
      ? anySignal([options.signal, timeoutController.signal])
      : timeoutController.signal;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as { name?: string }).name === "AbortError";
      if (aborted && options.signal?.aborted) {
        throw new CryptohopperError({
          code: "NETWORK_ERROR",
          message: "Request aborted",
          status: 0,
        });
      }
      throw new CryptohopperError({
        code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
        message: aborted
          ? `Request timed out after ${timeoutMs}ms`
          : `Could not reach ${this.baseUrl} (${(err as Error).message})`,
        status: 0,
      });
    }
    clearTimeout(timer);

    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-JSON body — parsed stays null */
      }
    }

    if (!res.ok) {
      const err = (parsed as ApiErrorBody | null)?.error;
      const code = (err?.code as string) ?? defaultCodeForStatus(res.status);
      const message = err?.message ?? `Request failed (${res.status})`;
      const retryAfter = res.headers.get("retry-after");
      const retryAfterMs = retryAfter ? parseRetryAfter(retryAfter) : undefined;
      throw new CryptohopperError({
        code,
        message,
        status: res.status,
        requestId,
        retryAfterMs,
      });
    }

    const ok = parsed as ApiOkBody<T> | null;
    if (!ok || typeof ok !== "object" || !("data" in ok)) {
      return parsed as T;
    }
    return ok.data;
  }

  /** Internal escape hatch: resources that need the raw fetch (e.g. uploads
   * doing a direct S3 PUT) still honour the injected fetch impl. */
  __internalFetch(): typeof fetch {
    return this.fetchImpl;
  }
}

function defaultCodeForStatus(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

function parseRetryAfter(header: string): number | undefined {
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn(signals);

  const ctrl = new AbortController();
  const forward = (s: AbortSignal) => {
    if (s.aborted) ctrl.abort(s.reason);
    else s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  };
  signals.forEach(forward);
  return ctrl.signal;
}
