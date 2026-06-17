import type { CryptohopperClient } from "../client.js";

export interface SubdomainCheckResult {
  valid: boolean;
  available: boolean;
  error?: string;
}
export interface SubdomainSuggestResult {
  suggestion: string | null;
}

export class Subdomains {
  constructor(private readonly client: CryptohopperClient) {}

  check(slug: string): Promise<SubdomainCheckResult> {
    return this.client.__request<SubdomainCheckResult>(
      "GET",
      `/api/v1/subdomains/check?subdomain=${encodeURIComponent(slug)}`,
    );
  }

  suggest(prompt: string): Promise<SubdomainSuggestResult> {
    return this.client.__request<SubdomainSuggestResult>(
      "GET",
      `/api/v1/subdomains/suggest?prompt=${encodeURIComponent(prompt)}`,
    );
  }
}
