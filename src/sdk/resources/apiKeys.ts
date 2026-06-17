import type { CryptohopperClient } from "../client.js";
import { CryptohopperError } from "../errors.js";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: unknown;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IssuedApiKey {
  id: string;
  rawKey: string;
  keyPrefix: string;
}

export class ApiKeys {
  constructor(private readonly client: CryptohopperClient) {}

  async list(): Promise<ApiKeySummary[]> {
    const data = await this.client.__request<{ keys: ApiKeySummary[] }>(
      "GET",
      "/api/v1/api-keys",
    );
    return data.keys;
  }

  create(input: { name: string }): Promise<IssuedApiKey> {
    return this.client.__request<IssuedApiKey>("POST", "/api/v1/api-keys", input);
  }

  async remove(idOrName: string): Promise<{ success: boolean }> {
    // Always list + match on either field. One extra GET is worth the
    // simpler mental model (callers don't care whether they pass id or name).
    const all = await this.list();
    const match = all.find((k) => k.id === idOrName || k.name === idOrName);
    if (!match) {
      throw new CryptohopperError({
        code: "NOT_FOUND",
        message: `API key not found: ${idOrName}`,
        status: 404,
      });
    }
    return this.client.__request<{ success: boolean }>(
      "DELETE",
      `/api/v1/api-keys/${encodeURIComponent(match.id)}`,
    );
  }
}
