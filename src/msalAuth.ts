/** MSAL SPA sign-in for Microsoft Graph (OneDrive). */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
  type RedirectRequest,
} from '@azure/msal-browser';
import { msalConfigured, readMsalEnv } from './cloudConfig';

const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite'];

let pca: PublicClientApplication | null = null;
let initDone = false;

export type AuthListener = () => void;
const listeners: AuthListener[] = [];

export function subscribeAuth(fn: AuthListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notifyAuth(): void {
  for (const fn of [...listeners]) fn();
}

export function isAuthReady(): boolean {
  return initDone;
}

export function getAccount(): AccountInfo | null {
  if (!pca) return null;
  const active = pca.getActiveAccount();
  if (active) return active;
  const all = pca.getAllAccounts();
  if (all.length) {
    pca.setActiveAccount(all[0]);
    return all[0];
  }
  return null;
}

export function isSignedIn(): boolean {
  return getAccount() !== null;
}

export function displayName(): string | null {
  const a = getAccount();
  if (!a) return null;
  return a.name || a.username || a.localAccountId;
}

/**
 * Initialise MSAL and finish any redirect handshake.
 * Safe to call when env is missing — leaves auth disabled.
 */
export async function initAuth(): Promise<void> {
  if (initDone) return;
  const env = readMsalEnv();
  if (!env) {
    initDone = true;
    notifyAuth();
    return;
  }

  pca = new PublicClientApplication({
    auth: {
      clientId: env.clientId,
      authority: `https://login.microsoftonline.com/${env.tenantId}`,
      redirectUri: env.redirectUri,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: false,
    },
  });

  await pca.initialize();

  try {
    const result = await pca.handleRedirectPromise();
    if (result?.account) {
      pca.setActiveAccount(result.account);
    } else if (!pca.getActiveAccount()) {
      const accounts = pca.getAllAccounts();
      if (accounts.length) pca.setActiveAccount(accounts[0]);
    }
  } catch (e) {
    console.warn('Garden Survey: MSAL redirect handling failed', e);
  }

  initDone = true;
  notifyAuth();
}

export async function signIn(): Promise<{ ok: boolean; error?: string }> {
  if (!msalConfigured() || !pca) {
    return {
      ok: false,
      error:
        'Microsoft sign-in is not configured yet. Set VITE_MSAL_CLIENT_ID (see docs/entra-onedrive-setup.md).',
    };
  }
  const request: RedirectRequest = { scopes: GRAPH_SCOPES };
  try {
    await pca.loginRedirect(request);
    return { ok: true };
  } catch (e) {
    const error = plainAuthError(e);
    return { ok: false, error };
  }
}

export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  if (!pca) return { ok: true };
  try {
    const account = getAccount();
    await pca.logoutRedirect({
      account: account ?? undefined,
      postLogoutRedirectUri: readMsalEnv()?.redirectUri,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: plainAuthError(e) };
  }
}

/** Acquire a Graph access token; may redirect if interaction is required. */
export async function acquireGraphToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  if (!pca) {
    return {
      ok: false,
      error: 'Microsoft sign-in is not configured yet.',
    };
  }
  const account = getAccount();
  if (!account) {
    return { ok: false, error: 'Not signed in. Tap Sign in with Microsoft first.' };
  }

  try {
    const result: AuthenticationResult = await pca.acquireTokenSilent({
      account,
      scopes: GRAPH_SCOPES,
    });
    return { ok: true, token: result.accessToken };
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      try {
        await pca.acquireTokenRedirect({ account, scopes: GRAPH_SCOPES });
        return { ok: false, error: 'Redirecting to Microsoft to refresh your sign-in…' };
      } catch (redirectErr) {
        return { ok: false, error: plainAuthError(redirectErr) };
      }
    }
    return { ok: false, error: plainAuthError(e) };
  }
}

function plainAuthError(e: unknown): string {
  if (e && typeof e === 'object' && 'errorMessage' in e) {
    const msg = String((e as { errorMessage?: string }).errorMessage ?? '');
    if (msg) return msg;
  }
  if (e instanceof Error) return e.message;
  return 'Microsoft sign-in failed.';
}
