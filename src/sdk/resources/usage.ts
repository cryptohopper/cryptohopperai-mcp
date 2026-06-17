import type { CryptohopperClient } from "../client.js";

export interface UsageSummary {
  plan: {
    name: string;
    displayName: string;
    monthlyCredits: number;
    maxProjects: number;
    maxStorageMb: number;
    maxBandwidthMb: number;
  };
  credits: {
    currentCredits: number;
    rolledOverCredits: number;
    lifetimeCreditsUsed: number;
    rolloverExpiresAt: string | null;
  };
  currentPeriod: {
    start: string;
    end: string;
    projectsCreated: number;
    buildsUsed: number;
    refinementsUsed: number;
    storageUsedMb: number;
    bandwidthUsedMb: number;
  };
}

export class Usage {
  constructor(private readonly client: CryptohopperClient) {}

  summary(): Promise<UsageSummary> {
    return this.client.__request<UsageSummary>("GET", "/api/v1/usage/summary");
  }
}
