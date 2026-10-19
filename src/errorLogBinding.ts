/**
 * Keep the error log on screen without redrawing the whole app.
 * A log append only patches the log panel and the ☰ button in place.
 * A full render happens only through the app's own state subscriptions.
 */
import { subscribeErrorLog } from './errorLog';

export interface ErrorLogViewHooks {
  /** Patch the log roller, menu status and ☰ in place. Must not rebuild the app. */
  refreshInPlace: () => void;
}

export function bindErrorLogView(
  hooks: ErrorLogViewHooks,
  subscribe: (fn: () => void) => () => void = subscribeErrorLog,
): () => void {
  let queued = false;
  const flush = () => {
    queued = false;
    hooks.refreshInPlace();
  };
  return subscribe(() => {
    // Several log lines in one tick (a retry storm) patch the DOM once.
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  });
}

/** Remember which upload error was last logged for each photo, so a repeat is not logged again. */
export function createOncePerKeyLogger(log: (message: string) => void): (key: string, message: string) => boolean {
  const last = new Map<string, string>();
  return (key, message) => {
    if (last.get(key) === message) return false;
    last.set(key, message);
    log(message);
    return true;
  };
}
