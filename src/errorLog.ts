/**
 * In-app error log — global capture + coach/UI failures.
 * Persists in localStorage; unseen flag drives hamburger red state.
 */

export interface ErrorLogEntry {
  id: string;
  at: string;
  message: string;
  stack?: string;
  source?: string;
}

const STORAGE_KEY = 'garden-survey:error-log';
const SEEN_KEY = 'garden-survey:error-log-seen-id';
const MAX_ENTRIES = 80;

type Listener = () => void;
const listeners: Listener[] = [];

let entries: ErrorLogEntry[] = loadEntries();
let lastSeenId: string | null = loadSeenId();
let installed = false;

export function subscribeErrorLog(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function loadEntries(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ErrorLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSeenId(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

function persistSeen(): void {
  try {
    if (lastSeenId) localStorage.setItem(SEEN_KEY, lastSeenId);
    else localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getErrorLog(): ErrorLogEntry[] {
  return entries.slice();
}

export function hasUnseenErrors(): boolean {
  if (!entries.length) return false;
  return entries[0].id !== lastSeenId;
}

export function unseenErrorCount(): number {
  if (!entries.length) return 0;
  if (!lastSeenId) return entries.length;
  const idx = entries.findIndex((e) => e.id === lastSeenId);
  if (idx < 0) return entries.length;
  return idx;
}

/** Mark all current errors as seen (call when Error log section is opened). */
export function markErrorsSeen(): void {
  if (!entries.length) {
    lastSeenId = null;
  } else {
    lastSeenId = entries[0].id;
  }
  persistSeen();
  notify();
}

export function clearErrorLog(): void {
  entries = [];
  lastSeenId = null;
  persist();
  persistSeen();
  notify();
}

export function logError(
  message: string,
  opts: { stack?: string; source?: string } = {},
): void {
  const msg = (message || 'Unknown error').trim();
  if (!msg) return;
  const entry: ErrorLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    message: msg.slice(0, 2000),
    stack: opts.stack?.slice(0, 4000),
    source: opts.source,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  persist();
  notify();
}

/** Install once — window.onerror + unhandledrejection. */
export function installGlobalErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (ev) => {
    const msg =
      ev.message ||
      (ev.error instanceof Error ? ev.error.message : 'Script error');
    const stack = ev.error instanceof Error ? ev.error.stack : undefined;
    logError(msg, { stack, source: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    let msg = 'Unhandled promise rejection';
    let stack: string | undefined;
    if (reason instanceof Error) {
      msg = reason.message;
      stack = reason.stack;
    } else if (typeof reason === 'string') {
      msg = reason;
    } else {
      try {
        msg = JSON.stringify(reason);
      } catch {
        msg = String(reason);
      }
    }
    logError(msg, { stack, source: 'unhandledrejection' });
  });
}
