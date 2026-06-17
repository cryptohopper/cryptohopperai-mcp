/**
 * Cryptohopper.AI MCP server (stdio transport).
 *
 * Exposes a curated subset of the vendored Cryptohopper.AI SDK surface as MCP
 * tools so that LLM hosts (Claude Desktop, Cursor, Zed, etc.) can build, poll,
 * and refine Cryptohopper.AI projects on behalf of the user.
 *
 * Auth is via the CRYPTOHOPPER_API_KEY env var. The host is expected to pass it
 * in when spawning this process — see the README for config snippets.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CryptohopperClient } from "./sdk/index.js";

import { registerTools } from "./tools.js";
import { CURRENT_VERSION as PACKAGE_VERSION } from "./version.js";

async function main(): Promise<void> {
  const apiKey = process.env.CRYPTOHOPPER_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "cryptohopperai-mcp: CRYPTOHOPPER_API_KEY is not set. See https://github.com/cryptohopper/cryptohopperai-mcp#configuration.\n",
    );
    process.exit(2);
  }

  const cryptohopper = new CryptohopperClient({
    apiKey,
    baseUrl: process.env.CRYPTOHOPPER_API_URL,
    userAgent: `cryptohopperai-mcp/${PACKAGE_VERSION}`,
  });

  const server = new McpServer(
    { name: "cryptohopper-mcp", version: PACKAGE_VERSION },
    {
      instructions:
        "Tools for building and refining Cryptohopper.AI projects. Call list_projects " +
        "to find a project's id or subdomain before refine/status calls. Status " +
        "polling takes a while — project_status is cheap to call; wait_for_live " +
        "blocks and is suitable for short builds only.",
    },
  );

  registerTools(server, cryptohopper);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so the stdio transport's stdout stays clean.
  process.stderr.write(`cryptohopper-mcp ${PACKAGE_VERSION} ready (stdio)\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `cryptohopper-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
