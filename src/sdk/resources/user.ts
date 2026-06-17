import type { CryptohopperClient } from "../client.js";

export interface MeUser {
  id: string;
  email: string | null;
  name?: string | null;
  role: string;
}
export interface MeResult {
  user: MeUser;
  source: "api_key" | "cli";
}

export class User {
  constructor(private readonly client: CryptohopperClient) {}

  me(): Promise<MeResult> {
    return this.client.__request<MeResult>("GET", "/api/v1/user/me");
  }
}
