import type { CryptohopperClient } from "../client.js";
import { CryptohopperError } from "../errors.js";
import type { ProjectStatus, ProjectStatusEvent } from "./types.js";
import { TERMINAL_PROJECT_STATUSES } from "./types.js";

interface ProjectStatusApi {
  step: number;
  totalSteps: number;
  status: string;
  message: string;
  progress?: number;
  queuePosition?: number;
}

/**
 * Yields status events for a project until a terminal state is reached.
 * De-duplicates identical consecutive snapshots (same status / step /
 * progress / queuePosition) so callers don't see dozens of identical
 * "queued" events while the build waits.
 *
 * Aborting via `opts.signal` throws a CryptohopperError out of the for-await loop.
 */
export async function* pollProjectStatus(
  client: CryptohopperClient,
  projectId: string,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<ProjectStatusEvent, void, void> {
  const intervalMs = opts.intervalMs ?? client.pollIntervalMs;
  let previous: string | null = null;

  while (true) {
    if (opts.signal?.aborted) {
      throw new CryptohopperError({
        code: "NETWORK_ERROR",
        message: "Poll aborted",
        status: 0,
      });
    }

    const snap = await client.__request<ProjectStatusApi>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/status`,
      undefined,
      { signal: opts.signal },
    );

    const status = snap.status as ProjectStatus;
    const key = `${status}|${snap.step}|${snap.progress ?? ""}|${snap.queuePosition ?? ""}`;
    if (key !== previous) {
      previous = key;
      yield {
        status,
        step: snap.step,
        totalSteps: snap.totalSteps,
        message: snap.message,
        progress: snap.progress,
        queuePosition: snap.queuePosition,
      };
    }

    if (TERMINAL_PROJECT_STATUSES.has(status)) return;
    await sleep(intervalMs, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new CryptohopperError({ code: "NETWORK_ERROR", message: "Poll aborted", status: 0 }),
      );
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(
        new CryptohopperError({ code: "NETWORK_ERROR", message: "Poll aborted", status: 0 }),
      );
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
