export { CryptohopperClient } from "./client.js";
export type { CryptohopperClientOptions, RequestOptions } from "./client.js";
export { CryptohopperError } from "./errors.js";
export type { CryptohopperErrorCode, KnownCryptohopperErrorCode } from "./errors.js";
export { CURRENT_VERSION } from "./version.js";

export type {
  ProjectStatus,
  BotType,
  ProjectStatusEvent,
} from "./util/types.js";

export type {
  Project,
  CreateProjectInput,
  CreatedProject,
  RefineInput,
  RefineResult,
  ConversationMessage,
  ConversationsResult,
} from "./resources/projects.js";

export type { ProjectSecretSummary } from "./resources/secrets.js";
export type { ApiKeySummary, IssuedApiKey } from "./resources/apiKeys.js";
export type {
  LibraryProject,
  LibraryListOptions,
  ClonedProject,
} from "./resources/library.js";
export type {
  SubdomainCheckResult,
  SubdomainSuggestResult,
} from "./resources/subdomains.js";
export type { UsageSummary } from "./resources/usage.js";
export type {
  CurrentSubscription,
  SubscriptionPlan,
  SubscriptionCredits,
} from "./resources/subscriptions.js";
export type { MeUser, MeResult } from "./resources/user.js";
export type {
  UploadedAttachment,
  CreateUploadInput,
} from "./resources/uploads.js";
