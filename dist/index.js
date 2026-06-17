#!/usr/bin/env node

// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/sdk/errors.ts
var CryptohopperError = class extends Error {
  code;
  status;
  requestId;
  retryAfterMs;
  constructor(opts) {
    super(opts.message);
    this.name = "CryptohopperError";
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
  }
};

// src/sdk/version.ts
var CURRENT_VERSION = "0.1.0-alpha.1";

// src/sdk/util/types.ts
var TERMINAL_PROJECT_STATUSES = /* @__PURE__ */ new Set([
  "live",
  "failed",
  "cancelled",
  "archived"
]);

// src/sdk/util/poll.ts
async function* pollProjectStatus(client, projectId, opts = {}) {
  const intervalMs = opts.intervalMs ?? client.pollIntervalMs;
  let previous = null;
  while (true) {
    if (opts.signal?.aborted) {
      throw new CryptohopperError({
        code: "NETWORK_ERROR",
        message: "Poll aborted",
        status: 0
      });
    }
    const snap = await client.__request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/status`,
      void 0,
      { signal: opts.signal }
    );
    const status = snap.status;
    const key = `${status}|${snap.step}|${snap.progress ?? ""}|${snap.queuePosition ?? ""}`;
    if (key !== previous) {
      previous = key;
      yield {
        status,
        step: snap.step,
        totalSteps: snap.totalSteps,
        message: snap.message,
        progress: snap.progress,
        queuePosition: snap.queuePosition
      };
    }
    if (TERMINAL_PROJECT_STATUSES.has(status)) return;
    await sleep(intervalMs, opts.signal);
  }
}
function sleep(ms, signal) {
  return new Promise((resolve2, reject) => {
    if (signal?.aborted) {
      reject(
        new CryptohopperError({ code: "NETWORK_ERROR", message: "Poll aborted", status: 0 })
      );
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(
        new CryptohopperError({ code: "NETWORK_ERROR", message: "Poll aborted", status: 0 })
      );
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// src/sdk/resources/projects.ts
var Projects = class {
  constructor(client) {
    this.client = client;
  }
  client;
  create(input) {
    return this.client.__request("POST", "/api/v1/projects", input);
  }
  list(opts = {}) {
    const path = opts.teamId ? `/api/v1/projects?teamId=${encodeURIComponent(opts.teamId)}` : "/api/v1/projects";
    return this.client.__request("GET", path);
  }
  /**
   * Fetch a single project by id or subdomain. There is no dedicated
   * GET /api/v1/projects/:id endpoint — we filter the list.
   */
  async get(ref, opts = {}) {
    const all = await this.list(opts);
    const found = all.find((p) => p.id === ref || p.subdomain === ref);
    if (!found) {
      throw new CryptohopperError({
        code: "NOT_FOUND",
        message: `Project not found: ${ref}`,
        status: 404
      });
    }
    return found;
  }
  status(ref) {
    return this.client.__request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(ref)}/status`
    );
  }
  cancel(ref) {
    return this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/cancel`
    );
  }
  reactivate(ref) {
    return this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/reactivate`
    );
  }
  async refine(ref, input) {
    const { wait, signal, ...body } = input;
    const result = await this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(ref)}/refine`,
      body
    );
    if (!wait) return result;
    return this.waitForLive(ref, { signal });
  }
  conversations(ref, opts = {}) {
    const qs = opts.limit ? `?limit=${opts.limit}` : "";
    return this.client.__request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(ref)}/conversations${qs}`
    );
  }
  /** Async iterator over status transitions. Terminates at a terminal state. */
  stream(ref, opts = {}) {
    return pollProjectStatus(this.client, ref, opts);
  }
  /**
   * Await the project reaching `live`. Throws CryptohopperError on non-live
   * terminal states (BUILD_FAILED / BUILD_CANCELLED).
   */
  async waitForLive(ref, opts = {}) {
    let last = null;
    for await (const ev of pollProjectStatus(this.client, ref, opts)) {
      last = ev;
    }
    if (!last) {
      throw new CryptohopperError({
        code: "UNKNOWN",
        message: "waitForLive: poll yielded no events",
        status: 0
      });
    }
    if (last.status === "failed") {
      throw new CryptohopperError({
        code: "BUILD_FAILED",
        message: last.message || "Build failed",
        status: 0
      });
    }
    if (last.status === "cancelled") {
      throw new CryptohopperError({
        code: "BUILD_CANCELLED",
        message: last.message || "Build cancelled",
        status: 0
      });
    }
    return this.get(ref);
  }
};

// src/sdk/resources/secrets.ts
var Secrets = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async list(projectRef) {
    const data = await this.client.__request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets`
    );
    return data.secrets;
  }
  async set(projectRef, key, value) {
    const data = await this.client.__request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets`,
      { key, value }
    );
    return data.secret;
  }
  remove(projectRef, key) {
    return this.client.__request(
      "DELETE",
      `/api/v1/projects/${encodeURIComponent(projectRef)}/secrets/${encodeURIComponent(key)}`
    );
  }
};

// src/sdk/resources/apiKeys.ts
var ApiKeys = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async list() {
    const data = await this.client.__request(
      "GET",
      "/api/v1/api-keys"
    );
    return data.keys;
  }
  create(input) {
    return this.client.__request("POST", "/api/v1/api-keys", input);
  }
  async remove(idOrName) {
    const all = await this.list();
    const match = all.find((k) => k.id === idOrName || k.name === idOrName);
    if (!match) {
      throw new CryptohopperError({
        code: "NOT_FOUND",
        message: `API key not found: ${idOrName}`,
        status: 404
      });
    }
    return this.client.__request(
      "DELETE",
      `/api/v1/api-keys/${encodeURIComponent(match.id)}`
    );
  }
};

// src/sdk/resources/library.ts
var Library = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async list(opts = {}) {
    const params = new URLSearchParams();
    if (opts.botType) params.set("botType", opts.botType);
    if (opts.search) params.set("search", opts.search);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.page) params.set("page", String(opts.page));
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const path = qs ? `/api/v1/library?${qs}` : "/api/v1/library";
    const data = await this.client.__request("GET", path);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && "items" in data) {
      return data.items;
    }
    return [];
  }
  clone(projectId, input) {
    return this.client.__request(
      "POST",
      `/api/v1/library/${encodeURIComponent(projectId)}/clone`,
      { subdomain: input.subdomain }
    );
  }
};

// src/sdk/resources/subdomains.ts
var Subdomains = class {
  constructor(client) {
    this.client = client;
  }
  client;
  check(slug) {
    return this.client.__request(
      "GET",
      `/api/v1/subdomains/check?subdomain=${encodeURIComponent(slug)}`
    );
  }
  suggest(prompt) {
    return this.client.__request(
      "GET",
      `/api/v1/subdomains/suggest?prompt=${encodeURIComponent(prompt)}`
    );
  }
};

// src/sdk/resources/uploads.ts
var EXT_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
var MAX_BYTES = 5 * 1024 * 1024;
function guessMimeType(fileName) {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_MIME[lower.slice(dot)] ?? null;
}
var Uploads = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async create(input) {
    const fileType = input.fileType ?? guessMimeType(input.fileName);
    if (!fileType || !Object.values(EXT_TO_MIME).includes(fileType)) {
      throw new CryptohopperError({
        code: "VALIDATION_ERROR",
        message: `Unsupported file type for ${input.fileName}. Allowed: png, jpg, gif, svg, webp, ico, pdf, txt, csv, doc, docx.`,
        status: 0
      });
    }
    const fileSize = input.file instanceof Blob ? input.file.size : input.file.byteLength;
    if (fileSize > MAX_BYTES) {
      throw new CryptohopperError({
        code: "VALIDATION_ERROR",
        message: `${input.fileName} is ${Math.round(fileSize / 1024 / 1024)} MB \u2014 the upload limit is 5 MB.`,
        status: 0
      });
    }
    const presign = await this.client.__request(
      "POST",
      "/api/v1/uploads",
      { fileName: input.fileName, fileType, fileSize }
    );
    const fetchImpl = this.client.__internalFetch();
    const put = await fetchImpl(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": fileType },
      // Buffer / Uint8Array / Blob are all valid fetch body types at runtime.
      // The lib-dom BodyInit isn't pulled in by our tsconfig, so cast through unknown.
      body: input.file
    });
    if (!put.ok) {
      throw new CryptohopperError({
        code: "UNKNOWN",
        message: `S3 upload failed (${put.status} ${put.statusText})`,
        status: put.status
      });
    }
    return { key: presign.key, fileName: input.fileName, fileType, fileSize };
  }
};

// src/sdk/resources/usage.ts
var Usage = class {
  constructor(client) {
    this.client = client;
  }
  client;
  summary() {
    return this.client.__request("GET", "/api/v1/usage/summary");
  }
};

// src/sdk/resources/subscriptions.ts
var Subscriptions = class {
  constructor(client) {
    this.client = client;
  }
  client;
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
  current() {
    return this.client.__request(
      "GET",
      "/api/v1/subscriptions/current"
    );
  }
};

// src/sdk/resources/user.ts
var User = class {
  constructor(client) {
    this.client = client;
  }
  client;
  me() {
    return this.client.__request("GET", "/api/v1/user/me");
  }
};

// src/sdk/client.ts
var DEFAULT_BASE_URL = "https://www.cryptohopper.ai";
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_POLL_INTERVAL_MS = 2e3;
var CryptohopperClient = class {
  baseUrl;
  pollIntervalMs;
  apiKey;
  fetchImpl;
  timeoutMs;
  userAgentSuffix;
  projects;
  secrets;
  apiKeys;
  library;
  subdomains;
  uploads;
  usage;
  subscriptions;
  user;
  constructor(opts) {
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
  async __request(method, path, body, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const ua = `cryptohopperai-sdk/${CURRENT_VERSION}${this.userAgentSuffix ? ` ${this.userAgentSuffix}` : ""}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": ua,
      Accept: "application/json"
    };
    if (body !== void 0) headers["Content-Type"] = "application/json";
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = options.signal ? anySignal([options.signal, timeoutController.signal]) : timeoutController.signal;
    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err.name === "AbortError";
      if (aborted && options.signal?.aborted) {
        throw new CryptohopperError({
          code: "NETWORK_ERROR",
          message: "Request aborted",
          status: 0
        });
      }
      throw new CryptohopperError({
        code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
        message: aborted ? `Request timed out after ${timeoutMs}ms` : `Could not reach ${this.baseUrl} (${err.message})`,
        status: 0
      });
    }
    clearTimeout(timer);
    const requestId = res.headers.get("x-request-id") ?? void 0;
    const text = await res.text();
    let parsed = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
      }
    }
    if (!res.ok) {
      const err = parsed?.error;
      const code = err?.code ?? defaultCodeForStatus(res.status);
      const message = err?.message ?? `Request failed (${res.status})`;
      const retryAfter = res.headers.get("retry-after");
      const retryAfterMs = retryAfter ? parseRetryAfter(retryAfter) : void 0;
      throw new CryptohopperError({
        code,
        message,
        status: res.status,
        requestId,
        retryAfterMs
      });
    }
    const ok = parsed;
    if (!ok || typeof ok !== "object" || !("data" in ok)) {
      return parsed;
    }
    return ok.data;
  }
  /** Internal escape hatch: resources that need the raw fetch (e.g. uploads
   * doing a direct S3 PUT) still honour the injected fetch impl. */
  __internalFetch() {
    return this.fetchImpl;
  }
};
function defaultCodeForStatus(status) {
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
function parseRetryAfter(header) {
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1e3);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return void 0;
}
function anySignal(signals) {
  const anyFn = AbortSignal.any;
  if (typeof anyFn === "function") return anyFn(signals);
  const ctrl = new AbortController();
  const forward = (s) => {
    if (s.aborted) ctrl.abort(s.reason);
    else s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  };
  signals.forEach(forward);
  return ctrl.signal;
}

// src/tools.ts
import { readFile, stat } from "fs/promises";
import { basename, isAbsolute, resolve } from "path";
import { z } from "zod";
var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
function registerTools(server, cryptohopper) {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all Cryptohopper.AI projects the authenticated user has access to. Optionally scope to a team.",
      inputSchema: {
        teamId: z.string().optional().describe("Team id (uuid) to scope to")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ teamId }) => cryptohopper.projects.list(teamId ? { teamId } : {}))
  );
  server.registerTool(
    "get_project",
    {
      title: "Get a project",
      description: "Fetch a single project by id or subdomain. Returns the project's url, status, and metadata.",
      inputSchema: {
        ref: z.string().describe("Project id (uuid) or subdomain"),
        teamId: z.string().optional().describe("Team id (uuid) if the project lives in a team")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ ref, teamId }) => cryptohopper.projects.get(ref, teamId ? { teamId } : {}))
  );
  server.registerTool(
    "project_status",
    {
      title: "Project build status",
      description: "Fetch the current build/deploy status for a project. Cheap \u2014 safe to call in a polling loop.",
      inputSchema: {
        ref: z.string().describe("Project id (uuid) or subdomain")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ ref }) => cryptohopper.projects.status(ref))
  );
  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: "Create a new Cryptohopper.AI project from a natural-language prompt. Build kicks off immediately. Call wait_for_live to block until the site is up, or poll project_status.",
      inputSchema: {
        prompt: z.string().min(1).describe("Natural-language brief for the project"),
        name: z.string().optional(),
        subdomain: z.string().optional().describe("Override the auto-suggested subdomain slug"),
        botType: z.enum(["site", "app", "bot", "api", "internal", "game"]).optional().describe(
          "Project category. Default is `site`. Picks the codegen template + UI scaffolding the build uses."
        ),
        isAuthProtected: z.boolean().optional(),
        teamId: z.string().optional()
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    wrap(({ prompt, ...rest }) => cryptohopper.projects.create({ prompt, ...rest }))
  );
  server.registerTool(
    "refine_project",
    {
      title: "Refine a project with a new instruction",
      description: "Send a refinement message to an existing project. Triggers a follow-up build unless the backend decides it's a code-only edit. Pass `attachments` returned by `upload_from_path` to thread images, PDFs, or CSVs into the build prompt; pass `codeEditOnly: true` to force a small in-place code patch (skips redesign/replan).",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        message: z.string().min(1).describe("What to change"),
        attachments: z.array(
          z.object({
            key: z.string().describe("S3 key returned by upload_from_path"),
            fileName: z.string(),
            fileType: z.string().describe("MIME type, e.g. image/png"),
            fileSize: z.number().int().positive()
          })
        ).optional().describe(
          "Attachments returned by upload_from_path. The build sees them alongside the message."
        ),
        codeEditOnly: z.boolean().optional().describe(
          "Force a code-only edit (skip redesign/replan). Use for small tweaks; the backend still validates whether the change qualifies."
        ),
        wait: z.boolean().optional().describe("If true, block until the follow-up build reaches live/failed/cancelled.")
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    wrap(
      ({ ref, message, attachments, codeEditOnly, wait }) => cryptohopper.projects.refine(ref, {
        message,
        ...attachments ? { attachments } : {},
        ...codeEditOnly !== void 0 ? { codeEditOnly } : {},
        ...wait !== void 0 ? { wait } : {}
      })
    )
  );
  server.registerTool(
    "wait_for_live",
    {
      title: "Wait until a project is live",
      description: "Block (polling every 2 s) until the project reaches a terminal state. Returns the final Project on success, an error result on build-failed or build-cancelled.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        timeoutMs: z.number().int().positive().max(30 * 60 * 1e3).optional().describe("Max wait in ms. Defaults to 10 minutes.")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(async ({ ref, timeoutMs }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs ?? 10 * 60 * 1e3);
      try {
        return await cryptohopper.projects.waitForLive(ref, { signal: ac.signal });
      } finally {
        clearTimeout(timer);
      }
    })
  );
  server.registerTool(
    "cancel_project",
    {
      title: "Cancel an in-flight build",
      description: "Stop a queued or in-progress build. The project moves to status `cancelled`; use reactivate_project to resume it later.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain")
      },
      annotations: { destructiveHint: true, idempotentHint: true }
    },
    wrap(({ ref }) => cryptohopper.projects.cancel(ref))
  );
  server.registerTool(
    "reactivate_project",
    {
      title: "Reactivate a cancelled / archived project",
      description: "Resume a previously cancelled or archived project. Triggers a fresh build at the project's most recent prompt.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain")
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    wrap(({ ref }) => cryptohopper.projects.reactivate(ref))
  );
  server.registerTool(
    "get_conversations",
    {
      title: "Read a project's conversation history",
      description: "Fetch the message timeline (user prompts, assistant responses, deploy markers, queued messages) for a project. Useful for letting the LLM see what's already been said before composing a refinement.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        limit: z.number().int().positive().max(200).optional().describe("Max messages to return (default: server-side default)")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ ref, limit }) => cryptohopper.projects.conversations(ref, limit !== void 0 ? { limit } : void 0))
  );
  server.registerTool(
    "check_subdomain",
    {
      title: "Check subdomain availability",
      description: "Check whether a given subdomain slug is free.",
      inputSchema: {
        slug: z.string().min(1)
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ slug }) => cryptohopper.subdomains.check(slug))
  );
  server.registerTool(
    "suggest_subdomain",
    {
      title: "Suggest a subdomain from a prompt",
      description: "Ask the backend to generate a friendly subdomain slug based on a natural-language prompt.",
      inputSchema: {
        prompt: z.string().min(1)
      },
      annotations: { readOnlyHint: true, idempotentHint: false }
    },
    wrap(({ prompt }) => cryptohopper.subdomains.suggest(prompt))
  );
  server.registerTool(
    "list_secrets",
    {
      title: "List a project's secrets",
      description: "List secret keys for a project. Values are never returned \u2014 only names, because Cryptohopper.AI stores secrets one-way-encrypted.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain")
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(({ ref }) => cryptohopper.secrets.list(ref))
  );
  server.registerTool(
    "set_secret",
    {
      title: "Set a project secret",
      description: "Create or overwrite an environment secret on a project.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        name: z.string().min(1).describe("Secret key, e.g. STRIPE_SECRET_KEY"),
        value: z.string().min(1).describe("Secret value. Treat as sensitive.")
      },
      annotations: { destructiveHint: true, idempotentHint: true }
    },
    wrap(({ ref, name, value }) => cryptohopper.secrets.set(ref, name, value))
  );
  server.registerTool(
    "remove_secret",
    {
      title: "Remove a project secret",
      description: "Delete a secret from a project.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        name: z.string().min(1).describe("Secret key to delete")
      },
      annotations: { destructiveHint: true, idempotentHint: true }
    },
    wrap(({ ref, name }) => cryptohopper.secrets.remove(ref, name))
  );
  server.registerTool(
    "list_library_projects",
    {
      title: "List public library projects",
      description: "Browse the public Cryptohopper.AI project library. Optionally filter by bot type, search keyword, or sort order. Use clone_library_project to copy one into the user's account.",
      inputSchema: {
        botType: z.string().optional().describe("Filter to a bot type (e.g. site, app, bot)"),
        search: z.string().optional().describe("Free-text keyword search"),
        sort: z.enum(["popular", "newest"]).optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional()
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap((opts) => cryptohopper.library.list(opts))
  );
  server.registerTool(
    "clone_library_project",
    {
      title: "Clone a library project",
      description: "Duplicate a public library project into the user's account under a chosen subdomain. The clone starts as a new project; use wait_for_live or project_status to watch its first build.",
      inputSchema: {
        projectId: z.string().describe("ID of the library project to clone"),
        subdomain: z.string().min(1).describe("Subdomain for the new project")
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    wrap(({ projectId, subdomain }) => cryptohopper.library.clone(projectId, { subdomain }))
  );
  server.registerTool(
    "usage_summary",
    {
      title: "Current-period usage + plan limits",
      description: "Return the authenticated user's plan limits and current-period consumption (credits remaining, builds used, storage / bandwidth, rollover expiry).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(() => cryptohopper.usage.summary())
  );
  server.registerTool(
    "current_subscription",
    {
      title: "Current plan + credit-balance snapshot",
      description: "Return the authenticated user's plan tier (price, billing period, cancel state, plan-level limits, features) plus current + rolled-over credits. Distinct from usage_summary \u2014 usage_summary covers current-period CONSUMPTION (credits used, builds run, storage), this covers the plan ITSELF (which tier, when does it renew). Both subscription and credits fields can be null for users mid-signup or cancelled with no grace credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(() => cryptohopper.subscriptions.current())
  );
  server.registerTool(
    "list_api_keys",
    {
      title: "List the user's API keys",
      description: "Return every API key the authenticated user has issued (name, prefix, scopes, last-used date \u2014 never the raw secret).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(() => cryptohopper.apiKeys.list())
  );
  server.registerTool(
    "create_api_key",
    {
      title: "Mint a new API key",
      description: "Issue a new API key for programmatic access. The raw secret is returned ONCE in the response \u2014 surface it to the user exactly once and do not persist it. Business plan required.",
      inputSchema: {
        name: z.string().min(1).describe("Human-readable label, e.g. 'my-ci'")
      },
      annotations: { destructiveHint: false, idempotentHint: false }
    },
    wrap(({ name }) => cryptohopper.apiKeys.create({ name }))
  );
  server.registerTool(
    "remove_api_key",
    {
      title: "Revoke an API key",
      description: "Revoke an API key by id or human-readable name. The SDK does a preflight list + id resolve, so either form works.",
      inputSchema: {
        idOrName: z.string().min(1).describe("API key id (uuid) or its name from list_api_keys")
      },
      annotations: { destructiveHint: true, idempotentHint: true }
    },
    wrap(({ idOrName }) => cryptohopper.apiKeys.remove(idOrName))
  );
  server.registerTool(
    "upload_from_path",
    {
      title: "Upload a local file as an attachment",
      description: "Read a file from the LLM host's local filesystem, presign a slot on Cryptohopper.AI, PUT the bytes directly to S3, and return an UploadedAttachment you can attach to refine_project. Use this when the user references a screenshot / PDF / CSV by path in the chat \u2014 the host process (Claude Desktop, Cursor, etc.) has read access to the working directory. Max 5 MB; allowed types: png, jpg, gif, svg, webp, ico, pdf, txt, csv, doc, docx.",
      inputSchema: {
        filePath: z.string().min(1).describe("Absolute or relative path to the file on the host machine"),
        fileType: z.string().optional().describe(
          "MIME type override (default: guessed from extension). Must be on the backend allowlist."
        )
      },
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    wrap(async ({ filePath, fileType }) => {
      const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
      const stats = await stat(absPath);
      if (!stats.isFile()) {
        throw new CryptohopperError({
          code: "VALIDATION_ERROR",
          message: `upload_from_path: ${absPath} is not a regular file`,
          status: 0
        });
      }
      if (stats.size > MAX_UPLOAD_BYTES) {
        throw new CryptohopperError({
          code: "VALIDATION_ERROR",
          message: `upload_from_path: ${basename(absPath)} is ${(stats.size / 1024 / 1024).toFixed(1)} MB \u2014 the upload limit is 5 MB.`,
          status: 0
        });
      }
      const bytes = await readFile(absPath);
      return cryptohopper.uploads.create({
        fileName: basename(absPath),
        file: bytes,
        ...fileType ? { fileType } : {}
      });
    })
  );
  server.registerTool(
    "whoami",
    {
      title: "Show the authenticated user",
      description: "Return the current user's id, email, and plan.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    wrap(() => cryptohopper.user.me())
  );
}
function wrap(impl) {
  return async (args) => {
    try {
      const value = await impl(args);
      return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
      };
    } catch (err) {
      const message = err instanceof CryptohopperError ? `[${err.code}${err.status ? ` ${err.status}` : ""}] ${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true
      };
    }
  };
}

// src/version.ts
var CURRENT_VERSION2 = "0.1.0-alpha.1";

// src/index.ts
async function main() {
  const apiKey = process.env.CRYPTOHOPPER_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "cryptohopperai-mcp: CRYPTOHOPPER_API_KEY is not set. See https://github.com/cryptohopper/cryptohopperai-mcp#configuration.\n"
    );
    process.exit(2);
  }
  const cryptohopper = new CryptohopperClient({
    apiKey,
    baseUrl: process.env.CRYPTOHOPPER_API_URL,
    userAgent: `cryptohopperai-mcp/${CURRENT_VERSION2}`
  });
  const server = new McpServer(
    { name: "cryptohopper-mcp", version: CURRENT_VERSION2 },
    {
      instructions: "Tools for building and refining Cryptohopper.AI projects. Call list_projects to find a project's id or subdomain before refine/status calls. Status polling takes a while \u2014 project_status is cheap to call; wait_for_live blocks and is suitable for short builds only."
    }
  );
  registerTools(server, cryptohopper);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`cryptohopper-mcp ${CURRENT_VERSION2} ready (stdio)
`);
}
main().catch((err) => {
  process.stderr.write(
    `cryptohopper-mcp fatal: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
//# sourceMappingURL=index.js.map