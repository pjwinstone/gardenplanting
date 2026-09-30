/** Vite env helpers for MSAL + OneDrive (Garden Survey). */

export const ONEDRIVE_FOLDER = 'Garden Survey';
/** Legacy fixed name — still loadable when present. */
export const ONEDRIVE_FILE = 'garden.json';
/** @deprecated prefer getGardenCloudFileName() — kept for older imports. */
export const ONEDRIVE_PATH = `${ONEDRIVE_FOLDER}/${ONEDRIVE_FILE}`;

const GARDEN_FILE_KEY = 'garden-survey:onedrive-garden-file';
const DEFAULT_VERSION = '1';

export interface MsalEnvConfig {
  clientId: string;
  tenantId: string;
  redirectUri: string;
}

export function readMsalEnv(): MsalEnvConfig | null {
  const clientId = (import.meta.env.VITE_MSAL_CLIENT_ID as string | undefined)?.trim();
  if (!clientId) return null;
  const tenantId =
    (import.meta.env.VITE_MSAL_TENANT_ID as string | undefined)?.trim() || 'common';
  const fromEnv = (import.meta.env.VITE_MSAL_REDIRECT_URI as string | undefined)?.trim();
  const fallback = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const redirectUri = ensureTrailingSlash(fromEnv || fallback);
  return { clientId, tenantId, redirectUri };
}

function ensureTrailingSlash(uri: string): string {
  try {
    const u = new URL(uri, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return `${u.origin}${u.pathname}`;
  } catch {
    return uri.endsWith('/') ? uri : `${uri}/`;
  }
}

export function msalConfigured(): boolean {
  return readMsalEnv() !== null;
}

/** Strip to a safe version token (e.g. 1, 0.1, 1.2-b). */
export function sanitizeGardenVersion(raw: string): string {
  const trimmed = raw.trim().replace(/^v/i, '');
  const v = trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
  return v || DEFAULT_VERSION;
}

export function gardenFileNameFromVersion(version: string): string {
  if (version.trim().toLowerCase() === 'legacy') return ONEDRIVE_FILE;
  return `garden-v${sanitizeGardenVersion(version)}.json`;
}

export function gardenVersionFromFileName(name: string): string {
  if (name === ONEDRIVE_FILE) return 'legacy';
  const m = /^garden-v(.+)\.json$/i.exec(name);
  return m?.[1] ? m[1] : DEFAULT_VERSION;
}

export function isGardenJsonName(name: string): boolean {
  return /^garden[\w.-]*\.json$/i.test(name);
}

export function onedrivePathFor(fileName: string): string {
  return `${ONEDRIVE_FOLDER}/${fileName}`;
}

export function getGardenCloudFileName(): string {
  try {
    const stored = localStorage.getItem(GARDEN_FILE_KEY)?.trim();
    if (stored && isGardenJsonName(stored)) return stored;
  } catch {
    /* ignore */
  }
  return gardenFileNameFromVersion(DEFAULT_VERSION);
}

export function setGardenCloudFileName(name: string): void {
  const safe = isGardenJsonName(name) ? name : gardenFileNameFromVersion(DEFAULT_VERSION);
  try {
    localStorage.setItem(GARDEN_FILE_KEY, safe);
  } catch {
    /* ignore */
  }
}

export function getGardenCloudVersion(): string {
  return gardenVersionFromFileName(getGardenCloudFileName());
}

/** Persist editable version → `garden-v{version}.json` (or legacy `garden.json`). */
export function setGardenCloudVersion(version: string): void {
  setGardenCloudFileName(gardenFileNameFromVersion(version));
}
