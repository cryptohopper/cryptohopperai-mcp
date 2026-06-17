import type { CryptohopperClient } from "../client.js";
import { CryptohopperError } from "../errors.js";
import { pollProjectStatus } from "../util/poll.js";
import type { BotType, ProjectStatus, ProjectStatusEvent } from "../util/types.js";

export interface Project {
  id: string;
  name: string;
  subdomain: string | null;
  status: ProjectStatus;
  botType: string | null;
  url: string | null;
  amplifyAppUrl: string | null;
  isPublic: boolean;
  isAuthProtected: boolean;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string | null;
}

export interface CreateProjectInput {
  prompt: string;
  name?: string;
  subdomain?: string;
  botType?: BotType;
  isAuthProtected?: boolean;
  teamId?: string;
}

export interface CreatedProject {
  project: Project;
  deployment: { id: string; status: string; version: number };
}

export interface RefineInput {
  message: string;
  attachments?: Array<{ key: string; fileName: string; fileType: string; fileSize: number }>;
  codeEditOnly?: boolean;
  /** If true, wait for the follow-up build to reach a terminal state. */
  wait?: boolean;
  signal?: AbortSignal;
}

export interface RefineQueued {
  queued: true;
  messageId: string;
}
export interface RefineSavedOnly {
  queued: false;
}
export interface RefineProcessing {
  processing: true;
  deploymentId: string;
  queuePriority: number;
}
export type RefineResult = RefineQueued | RefineSavedOnly | RefineProcessing;

export interface ConversationMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: unknown;
  status: "sent" | "queued" | "deleted";
  position: number | null;
  createdAt: string;
}
export interface ConversationsResult {
  messages: ConversationMessage[];
  queued: ConversationMessage[];
  latestVersion: number;
}

export class Projects {
  constructor(private readonly client: CryptohopperClient) {}

  create(input: CreateProjectInput): Promise<CreatedProject> {
    return this.client.__request<CreatedProject>("POST", "/api/v1/projects", input);
  }

  list(opts: { teamId?: string } = {}): Promise<Project[]> {
    const path = opts.teamId
      ? `/api/v1/projects?teamId=${encodeURIComponent(opts.teamId)}`
      : "/api/v1/projects";
    return this.client.__request<Project[]>("GET", path);
  }

  /**
   * Fetch a single project by id or subdomain. There is no dedicated
   * GET /api/v1/projects/:id endpoint — we filter the list.
   */
  async get(ref: string, opts: { teamId?: string } = {}): Promise<Project> {
    const all = await this.list(opts);
    const found = all.find((p) => p.id === ref || p.subdomain === ref);
    if (!found) {
      throw new CryptohopperError({
        code: "NOT_FOUND",
        message: `Project not found: ${ref}`,
        status: 404,
      });
    }
    return found;
  }

  status(ref: string): Promise<ProjectStatusEvent> {
    return this.client.__request<ProjectStatusEvent>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(ref)}/status`,
    );
  }

  cancel(ref: string): Promise<unknown> {
    return this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/cancel`,
    );
  }

  reactivate(ref: string): Promise<unknown> {
    return this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/reactivate`,
    );
  }

  async refine(ref: string, input: RefineInput): Promise<RefineResult | Project> {
    const { wait, signal, ...body } = input;
    const result = await this.client.__request<RefineResult>(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/refine`,
      body,
    );
    if (!wait) return result;
    return this.waitForLive(ref, { signal });
  }

  conversations(ref: string, opts: { limit?: number } = {}): Promise<ConversationsResult> {
    const qs = opts.limit ? `?limit=${opts.limit}` : "";
    return this.client.__request<ConversationsResult>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(ref)}/conversations${qs}`,
    );
  }

  /** Async iterator over status transitions. Terminates at a terminal state. */
  stream(ref: string, opts: { intervalMs?: number; signal?: AbortSignal } = {}) {
    return pollProjectStatus(this.client, ref, opts);
  }

  /**
   * Await the project reaching `live`. Throws CryptohopperError on non-live
   * terminal states (BUILD_FAILED / BUILD_CANCELLED).
   */
  async waitForLive(
    ref: string,
    opts: { intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<Project> {
    let last: ProjectStatusEvent | null = null;
    for await (const ev of pollProjectStatus(this.client, ref, opts)) {
      last = ev;
    }
    if (!last) {
      throw new CryptohopperError({
        code: "UNKNOWN",
        message: "waitForLive: poll yielded no events",
        status: 0,
      });
    }
    if (last.status === "failed") {
      throw new CryptohopperError({
        code: "BUILD_FAILED",
        message: last.message || "Build failed",
        status: 0,
      });
    }
    if (last.status === "cancelled") {
      throw new CryptohopperError({
        code: "BUILD_CANCELLED",
        message: last.message || "Build cancelled",
        status: 0,
      });
    }
    return this.get(ref);
  }
}
