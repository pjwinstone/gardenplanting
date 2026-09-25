/** Coach-visible Microsoft / OneDrive sync status. */

import { ONEDRIVE_PATH } from './cloudConfig';
import { msalConfigured } from './cloudConfig';
import { displayName, isSignedIn } from './msalAuth';

const LAST_SAVE_KEY = 'garden-survey:onedrive-last-save';

export interface CloudStatus {
  configured: boolean;
  signedIn: boolean;
  accountLabel: string | null;
  /** ISO timestamp of last successful OneDrive save, if any. */
  lastSaveIso: string | null;
  lastSaveLabel: string;
  /** Plain-language error or info line for the coach panel. */
  message: string | null;
  busy: boolean;
  pathHint: string;
}

type Listener = () => void;
const listeners: Listener[] = [];

let message: string | null = null;
let busy = false;

export function subscribeCloud(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

export function getLastSaveIso(): string | null {
  try {
    return localStorage.getItem(LAST_SAVE_KEY);
  } catch {
    return null;
  }
}

export function setLastSaveIso(iso: string): void {
  try {
    localStorage.setItem(LAST_SAVE_KEY, iso);
  } catch {
    /* ignore */
  }
  notify();
}

export function setCloudMessage(msg: string | null): void {
  message = msg;
  notify();
}

export function setCloudBusy(value: boolean): void {
  busy = value;
  notify();
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never saved to OneDrive from this browser.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last save time unknown.';
  try {
    return `Last OneDrive save: ${d.toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}.`;
  } catch {
    return `Last OneDrive save: ${iso}.`;
  }
}

export function getCloudStatus(): CloudStatus {
  const configured = msalConfigured();
  const signedIn = configured && isSignedIn();
  const lastSaveIso = getLastSaveIso();
  let accountLabel: string | null = null;
  if (signedIn) accountLabel = displayName();

  return {
    configured,
    signedIn,
    accountLabel,
    lastSaveIso,
    lastSaveLabel: formatWhen(lastSaveIso),
    message,
    busy,
    pathHint: `/${ONEDRIVE_PATH}`,
  };
}
