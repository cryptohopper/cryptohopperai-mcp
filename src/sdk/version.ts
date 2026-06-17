/**
 * Single runtime source of truth for the SDK version. Bumped together with
 * `package.json#version` on every release. See the CLI's equivalent pattern
 * (docs/cli.md → "Runtime version: one constant, not npm_package_version")
 * for why we do NOT read `process.env.npm_package_version` — compiled/bundled
 * consumers don't have it.
 */
export const CURRENT_VERSION = "0.1.0-alpha.1";
