/** MSAL SPA sign-in for Microsoft Graph (OneDrive). Redirect-first for iOS Safari. */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  BrowserAuthError,
  type AccountInfo,
  type AuthenticationResult,
  type RedirectRequest,
} from '@azure/msal-browser';
import { msalConfigured, readMsalEnv } from './cloudConfig';

const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite'];

let pca: PublicClientApplication | null = null;
let initDone = false;

/** Outcome of the latest initAuth() — coach uses this for errors / welcome. */
export interface AuthInitResult {
  configured: boolean;
  signedIn: boolean;
  /** True when handleRedirectPromise returned an account (fresh login). */
  fromRedirect: boolean;
  error?: string;
  accountLabel?: string | null;
}

let lastInit: AuthInitResult = {
  configured: false,
  signedIn: false,
  fromRedirect: false,
};

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

export function getAuthInitResult(): AuthInitResult {
  return lastInit;
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

function restoreCachedAccount(): AccountInfo | null {
  if (!pca) return null;
  if (!pca.getActiveAccount()) {
    const accounts = pca.getAllAccounts();
    if (accounts.length) pca.setActiveAccount(accounts[0]);
  }
  return getAccount();
}

/**
 * Initialise MSAL and finish any redirect handshake before the UI decides signed-out.
 * Safe to call when env is missing — leaves auth disabled.
 */
export async function initAuth(): Promise<AuthInitResult> {
  if (initDone) return lastInit;

  const env = readMsalEnv();
  if (!env) {
    lastInit = { configured: false, signedIn: false, fromRedirect: false };
    initDone = true;
    notifyAuth();
    return lastInit;
  }

  // Redirect URI must match Entra SPA registration and Vite `base` (trailing slash).
  const redirectUri = env.redirectUri;

  pca = new PublicClientApplication({
    auth: {
      clientId: env.clientId,
      authority: `https://login.microsoftonline.com/${env.tenantId}`,
      redirectUri,
      // Always land on the registered Pages URL (avoid odd return paths on iOS).
      navigateToLoginRequestUrl: false,
      postLogoutRedirectUri: redirectUri,
    },
    cache: {
      // Persist tokens across visits (first-party origin).
      cacheLocation: 'localStorage',
      // iOS Safari / ITP: keep PKCE + state across the Microsoft redirect hop.
      storeAuthStateInCookie: true,
    },
    system: {
      allowRedirectInIframe: false,
    },
  });

  await pca.initialize();

  let fromRedirect = false;
  let error: string | undefined;

  try {
    // Must run before any loginRedirect / before UI paints signed-out.
    const result = await pca.handleRedirectPromise();
    if (result?.account) {
      pca.setActiveAccount(result.account);
      fromRedirect = true;
    } else {
      restoreCachedAccount();
    }
  } catch (e) {
    error = plainAuthError(e);
    console.warn('Garden Survey: MSAL redirect handling failed', e);
    // Still try cached accounts — a prior session may be usable.
    restoreCachedAccount();
  }

  // If the URL still shows an OAuth error and MSAL did not surface one, read it.
  if (!error && !isSignedIn()) {
    const fromUrl = readOAuthErrorFromUrl();
    if (fromUrl) error = fromUrl;
  }

  const account = restoreCachedAccount();
  lastInit = {
    configured: true,
    signedIn: account !== null,
    fromRedirect,
    error,
    accountLabel: account ? account.name || account.username || account.localAccountId : null,
  };
  initDone = true;
  notifyAuth();
  return lastInit;
}

/** Prefer redirect on all platforms (required for reliable iOS Safari). */
export async function signIn(): Promise<{ ok: boolean; error?: string }> {
  if (!msalConfigured() || !pca) {
    return {
      ok: false,
      error:
        'Microsoft sign-in is not configured yet. Set VITE_MSAL_CLIENT_ID (see docs/entra-onedrive-setup.md).',
    };
  }
  if (!initDone) {
    return { ok: false, error: 'Sign-in is still starting. Wait a moment and try again.' };
  }
  const request: RedirectRequest = { scopes: GRAPH_SCOPES };
  try {
    await pca.loginRedirect(request);
    // Page navigates away; caller should keep the “Opening…” message.
    return { ok: true };
  } catch (e) {
    // Interaction in progress — finish redirect handling and retry once.
    if (e instanceof BrowserAuthError && e.errorCode === 'interaction_in_progress') {
      try {
        await pca.handleRedirectPromise();
        restoreCachedAccount();
        if (isSignedIn()) return { ok: true };
        await pca.loginRedirect(request);
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, error: plainAuthError(retryErr) };
      }
    }
    return { ok: false, error: plainAuthError(e) };
  }
}

export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  if (!pca) return { ok: true };
  try {
    const account = getAccount();
    const redirectUri = readMsalEnv()?.redirectUri;
    await pca.logoutRedirect({
      account: account ?? undefined,
      postLogoutRedirectUri: redirectUri,
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

function readOAuthErrorFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const err =
      url.searchParams.get('error_description') ||
      url.searchParams.get('error') ||
      hashParam(url.hash, 'error_description') ||
      hashParam(url.hash, 'error');
    if (!err) return null;
    return decodeURIComponent(err.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function hashParam(hash: string, key: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return params.get(key);
}

function plainAuthError(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as {
      errorCode?: string;
      errorMessage?: string;
      message?: string;
    };
    const code = o.errorCode ? `[${o.errorCode}] ` : '';
    if (o.errorMessage) return `${code}${o.errorMessage}`;
    if (o.message) return `${code}${o.message}`;
  }
  if (e instanceof Error) return e.message;
  return 'Microsoft sign-in failed.';
}
