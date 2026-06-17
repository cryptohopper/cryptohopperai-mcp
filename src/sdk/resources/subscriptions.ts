import type { CryptohopperClient } from "../client.js";

/**
 * Plan + billing details for the authenticated user. Sourced from
 * `userSubscriptions` joined onto `subscriptionPlans` on the backend;
 * sensitive fields (Stripe customer / subscription IDs, invoice metadata)
 * are deliberately omitted from the wire shape.
 *
 * Both `subscription` and `credits` are nullable because a user may
 * exist without a subscription (e.g. mid-signup, or cancelled with no
 * grace credits remaining). Treat `null` as "no active subscription
 * data" rather than an error.
 */
export interface SubscriptionPlan {
  status: string;
  billingPeriod: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt: string | null;
  planName: string;
  planDisplayName: string;
  priceMonthly: number;
  priceAnnual: number;
  monthlyCredits: number;
  maxProjects: number;
  maxStorageMb: number;
  maxBandwidthMb: number;
  creditRolloverMonths: number;
  features: unknown;
}

export interface SubscriptionCredits {
  current: number;
  rolledOver: number;
  total: number;
  rolloverExpiresAt: string | null;
  lifetimeUsed: number;
}

export interface CurrentSubscription {
  subscription: SubscriptionPlan | null;
  credits: SubscriptionCredits | null;
}

export class Subscriptions {
  constructor(private readonly client: CryptohopperClient) {}

  /**
   * Fetch the authenticated user's current subscription + credit-balance
   * snapshot. Read-only; cheap to call.
   *
   * Distinct from {@link Usage.summary} — `usage.summary()` returns
   * current-period consumption (credits remaining + builds used + storage),
   * while `subscriptions.current()` returns the plan tier itself
   * (price, limits, billing period, cancel state). They overlap on
   * `monthlyCredits` and `maxProjects` but serve different audiences:
   * `usage.summary()` for "am I about to hit my limits?", `current()` for
   * "what plan is this user on, and when does it renew?"
   */
  current(): Promise<CurrentSubscription> {
    return this.client.__request<CurrentSubscription>(
      "GET",
      "/api/v1/subscriptions/current",
    );
  }
}
