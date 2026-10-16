/** Parse Microsoft Graph JSON errors for OneDrive calls. */

import { onedrivePathFor } from './cloudConfig';

export type GraphErrorParts = {
  code: string;
  message: string;
};

export function graphErrorFromPayload(payload: unknown): GraphErrorParts {
  const err =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: string; message?: string } }).error
      : undefined;
  const code = typeof err?.code === 'string' ? err.code.trim() : '';
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return { code, message };
}

export async function readGraphErrorParts(res: Response): Promise<GraphErrorParts> {
  try {
    const payload = await res.json();
    const parts = graphErrorFromPayload(payload);
    if (parts.code || parts.message) return parts;
    return { code: '', message: res.statusText || String(res.status) };
  } catch {
    return { code: '', message: res.statusText || String(res.status) };
  }
}

const SPO_LICENSE_USER_MESSAGE =
  'This Microsoft account’s organisation has no OneDrive/SharePoint licence. ' +
  'Sign out, then sign in with a personal Microsoft account that has OneDrive ' +
  '(for example outlook.com / hotmail.com / live.com) — not a work account without M365.';

/** True only for Graph responses that explicitly indicate missing SharePoint/OneDrive licensing. */
export function isSpoLicenseGraphError(parts: GraphErrorParts): boolean {
  const code = parts.code.toLowerCase();
  const message = parts.message.toLowerCase();
  if (/spolicense|spo_license|nospolicense/.test(code)) return true;
  if (/tenant does not have a spo licen/.test(message)) return true;
  if (/does not have a spo licen/.test(message)) return true;
  if (/no spo licen/.test(message)) return true;
  if (/\bspo licen/.test(message) && /(tenant|user|organisation|organization|company)/.test(message)) {
    return true;
  }
  return false;
}

function graphFailureSummary(status: number, parts: GraphErrorParts): string {
  const code = parts.code ? `, code=${parts.code}` : '';
  const msg = parts.message || '(no error message)';
  return `OneDrive request failed (HTTP ${status}${code}): ${msg}`;
}

/** User-facing OneDrive / Graph failure line (not for missing-file 404s handled elsewhere). */
export function formatGraphFailure(status: number, parts: GraphErrorParts, fileName: string): string {
  if (isSpoLicenseGraphError(parts)) return SPO_LICENSE_USER_MESSAGE;
  if (status === 401) {
    return `${graphFailureSummary(status, parts)} Sign in again.`;
  }
  if (status === 403) {
    return `${graphFailureSummary(status, parts)} Check Files.ReadWrite permission on the Entra app registration.`;
  }
  if (status === 404) {
    const code = parts.code ? `, code=${parts.code}` : '';
    return `Could not find /${onedrivePathFor(fileName)} on OneDrive (HTTP 404${code}).`;
  }
  if (status >= 500) {
    return `${graphFailureSummary(status, parts)} Try again in a moment.`;
  }
  return graphFailureSummary(status, parts);
}
