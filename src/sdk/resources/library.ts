import type { CryptohopperClient } from "../client.js";

export interface LibraryProject {
  id: string;
  name: string;
  description: string | null;
  subdomain: string | null;
  botType: string | null;
  cloneCount: number;
  createdAt: string;
}

export interface LibraryListOptions {
  botType?: string;
  search?: string;
  sort?: "popular" | "newest";
  page?: number;
  limit?: number;
}

export interface ClonedProject {
  id: string;
  name: string;
  subdomain: string | null;
  status: string;
}

export class Library {
  constructor(private readonly client: CryptohopperClient) {}

  async list(opts: LibraryListOptions = {}): Promise<LibraryProject[]> {
    const params = new URLSearchParams();
    if (opts.botType) params.set("botType", opts.botType);
    if (opts.search) params.set("search", opts.search);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.page) params.set("page", String(opts.page));
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const path = qs ? `/api/v1/library?${qs}` : "/api/v1/library";

    const data = await this.client.__request<unknown>("GET", path);
    if (Array.isArray(data)) return data as LibraryProject[];
    if (data && typeof data === "object" && "items" in data) {
      return (data as { items: LibraryProject[] }).items;
    }
    return [];
  }

  clone(projectId: string, input: { subdomain: string }): Promise<ClonedProject> {
    return this.client.__request<ClonedProject>(
      "POST",
      `/api/v1/library/${encodeURIComponent(projectId)}/clone`,
      { subdomain: input.subdomain },
    );
  }
}
