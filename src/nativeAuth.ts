/**
 * Microsoft sign-in for the iOS shell. The system browser
 * (ASWebAuthenticationSession) is used with the msauth redirect.
 * @azure/msal-browser stays on the website. A SPA redirect must be https,
 * so the custom scheme is not registered as an SPA redirect.
 */

import type { AccountInfo } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';
import { readMsalEnv } from './cloudConfig';
import { IOS_ENTRA_REDIRECT_URI } from './iosPublicConfig';

const GRAPH_SCOPES = 'User.Read Files.ReadWrite offline_access openid profile';

interface NativeProfile {
  homeAccountId: string;
  localAccountId: string;
  username: string;
  name?: string;
  tenantId: string;
}

interface GardenAuthPlugin {
  status(): Promise<Record<string, unknown>>;
  signIn(options: {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    scopes: string;
  }): Promise<Record<string, unknown>>;
  acquireToken(options: {
    clientId: string;
    tenantId: string;
    scopes: string;
    allowInteractive: boolean;
  }): Promise<Record<string, unknown>>;
  signOut(options: { tenantId: string; redirectUri: string }): Promise<void>;
}

const GardenAuth = Capacitor.registerPlugin<GardenAuthPlugin>('GardenAuth');

let profile: NativeProfile | null = null;

export function currentNativeAccount(): AccountInfo | null {
  if (!profile) return null;
  return {
    homeAccountId: profile.homeAccountId,
    environment: 'login.microsoftonline.com',
    tenantId: profile.tenantId || 'common',
    username: profile.username,
    localAccountId: profile.localAccountId,
    name: profile.name,
  };
}

export function clearNativeAccount(): void {
  profile = null;
}

function remember(raw: Record<string, unknown>): NativeProfile | null {
  const username = typeof raw.username === 'string' ? raw.username : '';
  const home = typeof raw.homeAccountId === 'string' ? raw.homeAccountId : '';
  const local = typeof raw.localAccountId === 'string' ? raw.localAccountId : home;
  if (!username && !home) return profile;
  profile = {
    homeAccountId: home || local || username,
    localAccountId: local || home || username,
    username: username || home,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    tenantId: typeof raw.tenantId === 'string' && raw.tenantId ? raw.tenantId : 'common',
  };
  return profile;
}

function clientConfig(): { clientId: string; tenantId: string } | null {
  const env = readMsalEnv();
  if (!env?.clientId) return null;
  return { clientId: env.clientId, tenantId: env.tenantId || 'common' };
}

export async function loadNativeSession(): Promise<{
  configured: boolean;
  signedIn: boolean;
  label: string | null;
  error?: string;
}> {
  const env = clientConfig();
  if (!env) {
    clearNativeAccount();
    return { configured: false, signedIn: false, label: null };
  }
  try {
    const status = await GardenAuth.status();
    if (status.signedIn === true) {
      const saved = remember(status);
      const label = saved?.name || saved?.username || null;
      return { configured: true, signedIn: true, label };
    }
    clearNativeAccount();
    return { configured: true, signedIn: false, label: null };
  } catch (error) {
    clearNativeAccount();
    return {
      configured: true,
      signedIn: false,
      label: null,
      error: error instanceof Error ? error.message : 'iOS sign-in could not start.',
    };
  }
}

export async function nativeSignIn(): Promise<{ ok: boolean; error?: string; label?: string | null }> {
  const env = clientConfig();
  if (!env) {
    return {
      ok: false,
      error:
        'Microsoft sign-in is not configured yet. Set VITE_MSAL_CLIENT_ID (see docs/entra-onedrive-setup.md).',
    };
  }
  try {
    const result = await GardenAuth.signIn({
      clientId: env.clientId,
      tenantId: env.tenantId,
      redirectUri: IOS_ENTRA_REDIRECT_URI,
      scopes: GRAPH_SCOPES,
    });
    const saved = remember(result);
    return { ok: true, label: saved?.name || saved?.username || null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Microsoft sign-in failed.' };
  }
}

export async function nativeSignOut(): Promise<void> {
  clearNativeAccount();
  const env = clientConfig();
  try {
    await GardenAuth.signOut({
      tenantId: env?.tenantId || 'common',
      redirectUri: IOS_ENTRA_REDIRECT_URI,
    });
  } catch (error) {
    console.warn('Garden Planting: native signOut plugin call failed', error);
  }
}

export async function nativeAcquireToken(
  allowInteractive: boolean,
): Promise<{ ok: true; token: string } | { ok: false; interactionRequired: boolean; error: string }> {
  const env = clientConfig();
  if (!env) {
    return { ok: false, interactionRequired: false, error: 'Microsoft sign-in is not configured yet.' };
  }
  try {
    const result = await GardenAuth.acquireToken({
      clientId: env.clientId,
      tenantId: env.tenantId,
      scopes: GRAPH_SCOPES,
      allowInteractive,
    });
    if (typeof result.accessToken === 'string' && result.accessToken) {
      remember(result);
      return { ok: true, token: result.accessToken };
    }
    if (result.interactionRequired === true) {
      return {
        ok: false,
        interactionRequired: true,
        error:
          typeof result.error === 'string' && result.error
            ? result.error
            : allowInteractive
              ? 'Not signed in. Tap Sign in with Microsoft first.'
              : 'Sign in to upload.',
      };
    }
    return {
      ok: false,
      interactionRequired: false,
      error: typeof result.error === 'string' && result.error ? result.error : 'Microsoft sign-in failed.',
    };
  } catch (error) {
    return {
      ok: false,
      interactionRequired: false,
      error: error instanceof Error ? error.message : 'Microsoft sign-in failed.',
    };
  }
}
