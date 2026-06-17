import type { CryptohopperClient } from "../client.js";

export interface ProjectSecretSummary {
  key: string;
  lastFour: string;
  createdAt: string;
  updatedAt: string;
}

export class Secrets {
  constructor(private readonly client: CryptohopperClient) {}

  async list(projectRef: string): Promise<ProjectSecretSummary[]> {
    const data = await this.client.__request<{ secrets: ProjectSecretSummary[] }>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets`,
    );
    return data.secrets;
  }

  async set(
    projectRef: string,
    key: string,
    value: string,
  ): Promise<ProjectSecretSummary> {
    const data = await this.client.__request<{ secret: ProjectSecretSummary }>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets`,
      { key, value },
    );
    return data.secret;
  }

  remove(
    projectRef: string,
    key: string,
  ): Promise<{ success: boolean; existed: boolean }> {
    return this.client.__request<{ success: boolean; existed: boolean }>(
      "DELETE",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets/${encodeURIComponent(key)}`,
    );
  }
}
