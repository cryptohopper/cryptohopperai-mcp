/**
 * Single exception type thrown by every SDK call on non-2xx responses (and
 * on network/abort failures). Unknown backend codes pass through in `.code`
 * via the `(string & {})` intersection so a new server code never breaks
 * callers' exhaustive switches.
 */

export type KnownCryptohopperErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "BUILD_FAILED"
  | "BUILD_CANCELLED"
  | "INSUFFICIENT_CREDITS"
  | "PAYMENT_FAILED"
  | "UNKNOWN";

export type CryptohopperErrorCode = KnownCryptohopperErrorCode | (string & {});

export class CryptohopperError extends Error {
  readonly code: CryptohopperErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(opts: {
    code: CryptohopperErrorCode;
    message: string;
    status: number;
    requestId?: string;
    retryAfterMs?: number;
  }) {
    super(opts.message);
    this.name = "CryptohopperError";
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
  }
}
