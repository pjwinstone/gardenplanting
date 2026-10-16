/**
 * In-app error log — global capture + coach/UI failures.
 * Persists in localStorage; unseen **error** severity drives hamburger red state.
 */

export type LogSeverity = 'error' | 'info';

export interface ErrorLogEntry {
  id: string;
  at: string;
  message: string;
  stack?: string;
  source?: string;
  /** error → red text + can drive ☰ alert; info → default colour, no ☰ red */
  severity?: LogSeverity;
}

const STORAGE_KEY = 'garden-survey:error-log';
const SEEN_KEY = 'garden-survey:error-log-seen-id';
const SEEN_IDS_KEY = 'garden-survey:error-log-seen-ids';
const MAX_ENTRIES = 80;

type Listener = () => void;
const listeners: Listener[] = [];

let entries: ErrorLogEntry[] = loadEntries();
let seenIds: Set<string> = loadSeenIds();
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

/** Classify a log line — red/☰ for real faults; info for soft workflow notes. */
export function classifyLogSeverity(message: string, source?: string): LogSeverity {
  const src = (source ?? '').toLowerCase();
  // Soft: browser cache full while OneDrive / export can still keep work
  if (src === 'persist-quota' || /quota has been exceeded|filled (this )?browser/i.test(message)) {
    return 'info';
  }
  if (
    src === 'unhandledrejection' ||
    src === 'window.onerror' ||
    src === 'boot' ||
    src === 'msal' ||
    src === 'onedrive' ||
    src === 'persist' ||
    src === 'import'
  ) {
    return 'error';
  }
  if (/load failed|unhandled|script error|could not save|could not read|access denied/i.test(message)) {
    return 'error';
  }
  // Soft coach / mode refusals — visible in the log, not a ☰ alarm
  if (
    src === 'coach' ||
    src === 'mode' ||
    src === 'close-house' ||
    src === 'object' ||
    src === 'baseline' ||
    src === 'house' ||
    src === 'add-point' ||
    src === 'stage2' ||
    src === 'adjust' ||
    src === 'demo'
  ) {
    return 'info';
  }
  return 'error';
}

function withSeverity(entry: ErrorLogEntry): ErrorLogEntry {
  if (entry.severity === 'error' || entry.severity === 'info') return entry;
  return {
    ...entry,
    severity: classifyLogSeverity(entry.message, entry.source),
  };
}

function loadEntries(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ErrorLogEntry[];
    return Array.isArray(parsed) ? parsed.map(withSeverity) : [];
  } catch {
    return [];
  }
}

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === 'string'));
      }
    }
    const legacy = localStorage.getItem(SEEN_KEY);
    if (!legacy) return new Set();
    const idx = entries.findIndex((e) => e.id === legacy);
    const ids = new Set<string>();
    if (idx < 0) {
      for (const e of entries) ids.add(e.id);
    } else {
      for (const e of entries.slice(idx)) ids.add(e.id);
    }
    try {
      localStorage.setItem(SEEN_IDS_KEY, JSON.stringify([...ids]));
      localStorage.removeItem(SEEN_KEY);
    } catch {
      /* ignore quota */
    }
    return ids;
  } catch {
    return new Set();
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

function persistSeenIds(): void {
  try {
    if (seenIds.size) localStorage.setItem(SEEN_IDS_KEY, JSON.stringify([...seenIds]));
    else localStorage.removeItem(SEEN_IDS_KEY);
  } catch {
    /* ignore */
  }
}

export function getErrorLog(): ErrorLogEntry[] {
  return entries.map(withSeverity);
}

export function isErrorLogEntrySeen(id: string): boolean {
  return seenIds.has(id);
}

/** Tap a log line — toggle seen (acknowledged) state for that entry. */
export function toggleErrorLogEntrySeen(id: string): void {
  if (!entries.some((e) => e.id === id)) return;
  if (seenIds.has(id)) seenIds.delete(id);
  else seenIds.add(id);
  persistSeenIds();
  notify();
}

/** Unseen **error** lines only — info never keeps the hamburger red. */
export function hasUnseenErrors(): boolean {
  return entries
    .map(withSeverity)
    .some((e) => e.severity === 'error' && !seenIds.has(e.id));
}

export function unseenErrorCount(): number {
  return entries
    .map(withSeverity)
    .filter((e) => e.severity === 'error' && !seenIds.has(e.id)).length;
}

export function clearErrorLog(): void {
  entries = [];
  seenIds = new Set();
  persist();
  persistSeenIds();
  notify();
}

export function logError(
  message: string,
  opts: { stack?: string; source?: string; severity?: LogSeverity } = {},
): void {
  const msg = (message || 'Unknown error').trim();
  if (!msg) return;
  const severity = opts.severity ?? classifyLogSeverity(msg, opts.source);
  const entry: ErrorLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    message: msg.slice(0, 2000),
    stack: opts.stack?.slice(0, 4000),
    source: opts.source,
    severity,
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
    logError(msg, { stack, source: 'window.onerror', severity: 'error' });
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
    logError(msg, { stack, source: 'unhandledrejection', severity: 'error' });
  });
}
