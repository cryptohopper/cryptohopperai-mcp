/**
 * MCP tool registrations. Each tool is a thin wrapper around a vendored
 * Cryptohopper.AI SDK resource method. Errors from the SDK are caught and
 * returned as `isError: true` tool results so the host can surface them.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CryptohopperClient, CryptohopperError } from "./sdk/index.js";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { z } from "zod";

/** Per-file ceiling the backend enforces. Keep in sync with the SDK. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function registerTools(server: McpServer, cryptohopper: CryptohopperClient): void {
  // ---------- projects ----------

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List all Cryptohopper.AI projects the authenticated user has access to. " +
        "Optionally scope to a team.",
      inputSchema: {
        teamId: z.string().optional().describe("Team id (uuid) to scope to"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ teamId }) => cryptohopper.projects.list(teamId ? { teamId } : {})),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get a project",
      description:
        "Fetch a single project by id or subdomain. Returns the project's " +
        "url, status, and metadata.",
      inputSchema: {
        ref: z.string().describe("Project id (uuid) or subdomain"),
        teamId: z.string().optional().describe("Team id (uuid) if the project lives in a team"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ ref, teamId }) => cryptohopper.projects.get(ref, teamId ? { teamId } : {})),
  );

  server.registerTool(
    "project_status",
    {
      title: "Project build status",
      description:
        "Fetch the current build/deploy status for a project. Cheap — safe " +
        "to call in a polling loop.",
      inputSchema: {
        ref: z.string().describe("Project id (uuid) or subdomain"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ ref }) => cryptohopper.projects.status(ref)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Create a new Cryptohopper.AI project from a natural-language prompt. " +
        "Build kicks off immediately. Call wait_for_live to block until the " +
        "site is up, or poll project_status.",
      inputSchema: {
        prompt: z.string().min(1).describe("Natural-language brief for the project"),
        name: z.string().optional(),
        subdomain: z.string().optional().describe("Override the auto-suggested subdomain slug"),
        botType: z
          .enum(["site", "app", "bot", "api", "internal", "game"])
          .optional()
          .describe(
            "Project category. Default is `site`. Picks the codegen template + UI scaffolding the build uses.",
          ),
        isAuthProtected: z.boolean().optional(),
        teamId: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    wrap(({ prompt, ...rest }) => cryptohopper.projects.create({ prompt, ...rest })),
  );

  server.registerTool(
    "refine_project",
    {
      title: "Refine a project with a new instruction",
      description:
        "Send a refinement message to an existing project. Triggers a " +
        "follow-up build unless the backend decides it's a code-only edit. " +
        "Pass `attachments` returned by `upload_from_path` to thread images, " +
        "PDFs, or CSVs into the build prompt; pass `codeEditOnly: true` to " +
        "force a small in-place code patch (skips redesign/replan).",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        message: z.string().min(1).describe("What to change"),
        attachments: z
          .array(
            z.object({
              key: z.string().describe("S3 key returned by upload_from_path"),
              fileName: z.string(),
              fileType: z.string().describe("MIME type, e.g. image/png"),
              fileSize: z.number().int().positive(),
            }),
          )
          .optional()
          .describe(
            "Attachments returned by upload_from_path. The build sees them alongside the message.",
          ),
        codeEditOnly: z
          .boolean()
          .optional()
          .describe(
            "Force a code-only edit (skip redesign/replan). Use for small tweaks; the backend still validates whether the change qualifies.",
          ),
        wait: z
          .boolean()
          .optional()
          .describe("If true, block until the follow-up build reaches live/failed/cancelled."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    wrap(({ ref, message, attachments, codeEditOnly, wait }) =>
      cryptohopper.projects.refine(ref, {
        message,
        ...(attachments ? { attachments } : {}),
        ...(codeEditOnly !== undefined ? { codeEditOnly } : {}),
        ...(wait !== undefined ? { wait } : {}),
      }),
    ),
  );

  server.registerTool(
    "wait_for_live",
    {
      title: "Wait until a project is live",
      description:
        "Block (polling every 2 s) until the project reaches a terminal state. " +
        "Returns the final Project on success, an error result on build-failed " +
        "or build-cancelled.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(30 * 60 * 1000)
          .optional()
          .describe("Max wait in ms. Defaults to 10 minutes."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(async ({ ref, timeoutMs }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs ?? 10 * 60 * 1000);
      try {
        return await cryptohopper.projects.waitForLive(ref, { signal: ac.signal });
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  server.registerTool(
    "cancel_project",
    {
      title: "Cancel an in-flight build",
      description:
        "Stop a queued or in-progress build. The project moves to status " +
        "`cancelled`; use reactivate_project to resume it later.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    wrap(({ ref }) => cryptohopper.projects.cancel(ref)),
  );

  server.registerTool(
    "reactivate_project",
    {
      title: "Reactivate a cancelled / archived project",
      description:
        "Resume a previously cancelled or archived project. Triggers a fresh " +
        "build at the project's most recent prompt.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    wrap(({ ref }) => cryptohopper.projects.reactivate(ref)),
  );

  server.registerTool(
    "get_conversations",
    {
      title: "Read a project's conversation history",
      description:
        "Fetch the message timeline (user prompts, assistant responses, deploy " +
        "markers, queued messages) for a project. Useful for letting the LLM see " +
        "what's already been said before composing a refinement.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max messages to return (default: server-side default)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ ref, limit }) => cryptohopper.projects.conversations(ref, limit !== undefined ? { limit } : undefined)),
  );

  // ---------- subdomains ----------

  server.registerTool(
    "check_subdomain",
    {
      title: "Check subdomain availability",
      description: "Check whether a given subdomain slug is free.",
      inputSchema: {
        slug: z.string().min(1),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ slug }) => cryptohopper.subdomains.check(slug)),
  );

  server.registerTool(
    "suggest_subdomain",
    {
      title: "Suggest a subdomain from a prompt",
      description:
        "Ask the backend to generate a friendly subdomain slug based on a " +
        "natural-language prompt.",
      inputSchema: {
        prompt: z.string().min(1),
      },
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    wrap(({ prompt }) => cryptohopper.subdomains.suggest(prompt)),
  );

  // ---------- secrets ----------

  server.registerTool(
    "list_secrets",
    {
      title: "List a project's secrets",
      description:
        "List secret keys for a project. Values are never returned — only " +
        "names, because Cryptohopper.AI stores secrets one-way-encrypted.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(({ ref }) => cryptohopper.secrets.list(ref)),
  );

  server.registerTool(
    "set_secret",
    {
      title: "Set a project secret",
      description: "Create or overwrite an environment secret on a project.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        name: z.string().min(1).describe("Secret key, e.g. STRIPE_SECRET_KEY"),
        value: z.string().min(1).describe("Secret value. Treat as sensitive."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    wrap(({ ref, name, value }) => cryptohopper.secrets.set(ref, name, value)),
  );

  server.registerTool(
    "remove_secret",
    {
      title: "Remove a project secret",
      description: "Delete a secret from a project.",
      inputSchema: {
        ref: z.string().describe("Project id or subdomain"),
        name: z.string().min(1).describe("Secret key to delete"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    wrap(({ ref, name }) => cryptohopper.secrets.remove(ref, name)),
  );

  // ---------- library ----------

  server.registerTool(
    "list_library_projects",
    {
      title: "List public library projects",
      description:
        "Browse the public Cryptohopper.AI project library. Optionally filter by " +
        "bot type, search keyword, or sort order. Use clone_library_project to " +
        "copy one into the user's account.",
      inputSchema: {
        botType: z
          .string()
          .optional()
          .describe("Filter to a bot type (e.g. site, app, bot)"),
        search: z.string().optional().describe("Free-text keyword search"),
        sort: z.enum(["popular", "newest"]).optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap((opts) => cryptohopper.library.list(opts)),
  );

  server.registerTool(
    "clone_library_project",
    {
      title: "Clone a library project",
      description:
        "Duplicate a public library project into the user's account under a " +
        "chosen subdomain. The clone starts as a new project; use " +
        "wait_for_live or project_status to watch its first build.",
      inputSchema: {
        projectId: z.string().describe("ID of the library project to clone"),
        subdomain: z.string().min(1).describe("Subdomain for the new project"),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    wrap(({ projectId, subdomain }) => cryptohopper.library.clone(projectId, { subdomain })),
  );

  // ---------- usage + api keys ----------

  server.registerTool(
    "usage_summary",
    {
      title: "Current-period usage + plan limits",
      description:
        "Return the authenticated user's plan limits and current-period " +
        "consumption (credits remaining, builds used, storage / bandwidth, " +
        "rollover expiry).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(() => cryptohopper.usage.summary()),
  );

  server.registerTool(
    "current_subscription",
    {
      title: "Current plan + credit-balance snapshot",
      description:
        "Return the authenticated user's plan tier (price, billing period, " +
        "cancel state, plan-level limits, features) plus current + rolled-over " +
        "credits. Distinct from usage_summary — usage_summary covers " +
        "current-period CONSUMPTION (credits used, builds run, storage), this " +
        "covers the plan ITSELF (which tier, when does it renew). Both " +
        "subscription and credits fields can be null for users mid-signup or " +
        "cancelled with no grace credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(() => cryptohopper.subscriptions.current()),
  );

  server.registerTool(
    "list_api_keys",
    {
      title: "List the user's API keys",
      description:
        "Return every API key the authenticated user has issued (name, " +
        "prefix, scopes, last-used date — never the raw secret).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(() => cryptohopper.apiKeys.list()),
  );

  server.registerTool(
    "create_api_key",
    {
      title: "Mint a new API key",
      description:
        "Issue a new API key for programmatic access. The raw secret is " +
        "returned ONCE in the response — surface it to the user exactly " +
        "once and do not persist it. Business plan required.",
      inputSchema: {
        name: z.string().min(1).describe("Human-readable label, e.g. 'my-ci'"),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    wrap(({ name }) => cryptohopper.apiKeys.create({ name })),
  );

  server.registerTool(
    "remove_api_key",
    {
      title: "Revoke an API key",
      description:
        "Revoke an API key by id or human-readable name. The SDK does a " +
        "preflight list + id resolve, so either form works.",
      inputSchema: {
        idOrName: z
          .string()
          .min(1)
          .describe("API key id (uuid) or its name from list_api_keys"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    wrap(({ idOrName }) => cryptohopper.apiKeys.remove(idOrName)),
  );

  // ---------- uploads (local-filesystem variant) ----------

  server.registerTool(
    "upload_from_path",
    {
      title: "Upload a local file as an attachment",
      description:
        "Read a file from the LLM host's local filesystem, presign a slot " +
        "on Cryptohopper.AI, PUT the bytes directly to S3, and return an " +
        "UploadedAttachment you can attach to refine_project. Use this " +
        "when the user references a screenshot / PDF / CSV by path in the " +
        "chat — the host process (Claude Desktop, Cursor, etc.) has read " +
        "access to the working directory. Max 5 MB; allowed types: png, " +
        "jpg, gif, svg, webp, ico, pdf, txt, csv, doc, docx.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .describe("Absolute or relative path to the file on the host machine"),
        fileType: z
          .string()
          .optional()
          .describe(
            "MIME type override (default: guessed from extension). Must be on the backend allowlist.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    wrap(async ({ filePath, fileType }) => {
      const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
      const stats = await stat(absPath);
      if (!stats.isFile()) {
        throw new CryptohopperError({
          code: "VALIDATION_ERROR",
          message: `upload_from_path: ${absPath} is not a regular file`,
          status: 0,
        });
      }
      if (stats.size > MAX_UPLOAD_BYTES) {
        throw new CryptohopperError({
          code: "VALIDATION_ERROR",
          message: `upload_from_path: ${basename(absPath)} is ${(stats.size / 1024 / 1024).toFixed(1)} MB — the upload limit is 5 MB.`,
          status: 0,
        });
      }
      const bytes = await readFile(absPath);
      return cryptohopper.uploads.create({
        fileName: basename(absPath),
        file: bytes,
        ...(fileType ? { fileType } : {}),
      });
    }),
  );

  // ---------- account ----------

  server.registerTool(
    "whoami",
    {
      title: "Show the authenticated user",
      description: "Return the current user's id, email, and plan.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    wrap(() => cryptohopper.user.me()),
  );
}

/**
 * Wraps a tool implementation so successful results are returned as JSON
 * text content and errors (especially CryptohopperError) surface as isError
 * results with the request id — letting the host display them to the user
 * without tearing down the MCP session.
 */
export function wrap<Args>(
  impl: (args: Args) => unknown | Promise<unknown>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      const value = await impl(args);
      return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      };
    } catch (err) {
      const message =
        err instanceof CryptohopperError
          ? `[${err.code}${err.status ? ` ${err.status}` : ""}] ${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  };
}
