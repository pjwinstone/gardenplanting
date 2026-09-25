/** Vite env helpers for MSAL + OneDrive (Garden Survey). */

export const ONEDRIVE_FOLDER = 'Garden Survey';
export const ONEDRIVE_FILE = 'garden.json';
/** Path under the signed-in user's OneDrive root. */
export const ONEDRIVE_PATH = `${ONEDRIVE_FOLDER}/${ONEDRIVE_FILE}`;

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
  const redirectUri =
    (import.meta.env.VITE_MSAL_REDIRECT_URI as string | undefined)?.trim() ||
    `${window.location.origin}${import.meta.env.BASE_URL}`;
  return { clientId, tenantId, redirectUri };
}

export function msalConfigured(): boolean {
  return readMsalEnv() !== null;
}
