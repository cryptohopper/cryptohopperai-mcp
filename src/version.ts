/**
 * Single source of truth for the MCP server version at runtime.
 *
 * Used in three places: the User-Agent header sent to the Cryptohopper.AI API,
 * the `version` field of the McpServer instance, and the stderr "ready"
 * banner.
 *
 * Bump this together with `package.json#version` on every release.
 */
export const CURRENT_VERSION = "0.1.0-alpha.1";
