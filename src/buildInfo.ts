/** Build stamp baked in at Vite / Pages build time. */

export function appVersion(): string {
  return (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '0.0.0-dev';
}

/** Short git SHA (or "local" when unset). */
export function appBuild(): string {
  const raw = (import.meta.env.VITE_APP_BUILD as string | undefined)?.trim();
  if (!raw) return 'local';
  return raw.slice(0, 7);
}

/** e.g. `Build 0.2.0 · abc1234` */
export function buildStamp(): string {
  return `Build ${appVersion()} · ${appBuild()}`;
}
