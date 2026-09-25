import { initAuth, getAuthInitResult } from './msalAuth';
import { mount, applyAuthReady } from './ui';

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) {
    throw new Error('#app missing');
  }

  root.innerHTML =
    '<p style="font-family:system-ui;padding:1.5rem">Starting Garden Survey…</p>';

  // Finish redirect handshake before the UI paints signed-out.
  await initAuth();
  root.innerHTML = '';
  mount(root);
  applyAuthReady(getAuthInitResult());
}

boot().catch((err) => {
  console.error(err);
  const root = document.querySelector('#app');
  if (root) {
    root.textContent =
      err instanceof Error ? err.message : 'Garden Survey failed to start.';
  }
});
