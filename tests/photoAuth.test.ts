import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireGraphToken, acquireGraphTokenSilent, setGraphTokenClientForTests } from '../src/msalAuth';

afterEach(() => {
  setGraphTokenClientForTests(null);
});

describe('background photo token', () => {
  it('does not redirect when silent auth needs interaction', async () => {
    let redirects = 0;
    setGraphTokenClientForTests({
      account: {
        homeAccountId: 'home',
        environment: 'login.microsoftonline.com',
        tenantId: 'common',
        username: 'paul@example.com',
        localAccountId: 'local',
      },
      acquireTokenSilent: async () => {
        throw new InteractionRequiredAuthError('interaction_required');
      },
      acquireTokenRedirect: async () => {
        redirects += 1;
      },
    });
    const silent = await acquireGraphTokenSilent();
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.interactionRequired).toBe(true);
    expect(redirects).toBe(0);

    const tapped = await acquireGraphToken();
    expect(tapped.ok).toBe(false);
    expect(redirects).toBe(1);
  });
});
