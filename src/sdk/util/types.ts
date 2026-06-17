/** The lifecycle state of a project / its latest deployment. */
export type ProjectStatus =
  | "draft"
  | "queued"
  | "generating"
  | "generated"
  | "deploying"
  | "live"
  | "failed"
  | "cancelled"
  | "archived";

/** Product category the user picked when creating the project. */
export type BotType =
  | "site"
  | "app"
  | "bot"
  | "api"
  | "internal"
  | "game";

export const TERMINAL_PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "live",
  "failed",
  "cancelled",
  "archived",
]);

/** What `projects.stream()` yields on each meaningful status transition. */
export interface ProjectStatusEvent {
  status: ProjectStatus;
  step: number;
  totalSteps: number;
  message: string;
  progress?: number;
  queuePosition?: number;
  url?: string;
}
