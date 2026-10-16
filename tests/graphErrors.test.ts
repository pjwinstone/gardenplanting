import { describe, expect, it } from 'vitest';
import { formatGraphFailure, isSpoLicenseGraphError } from '../src/graphErrors';

describe('isSpoLicenseGraphError', () => {
  it('matches explicit SPO licence messages', () => {
    expect(
      isSpoLicenseGraphError({
        code: 'BadRequest',
        message: 'Tenant does not have a SPO license.',
      }),
    ).toBe(true);
    expect(
      isSpoLicenseGraphError({
        code: 'SPOLicenseNotFound',
        message: 'User does not have a license.',
      }),
    ).toBe(true);
  });

  it('does not treat SharePointOnline class names as missing licence', () => {
    expect(
      isSpoLicenseGraphError({
        code: 'generalException',
        message:
          'Exception of type Microsoft.SharePoint.Client.SharePointOnlineClientException was thrown.',
      }),
    ).toBe(false);
    expect(
      isSpoLicenseGraphError({
        code: 'accessDenied',
        message: 'Access denied',
      }),
    ).toBe(false);
  });
});

describe('formatGraphFailure', () => {
  it('shows HTTP status and code for non-licence errors', () => {
    const msg = formatGraphFailure(
      403,
      { code: 'accessDenied', message: 'Access denied' },
      'garden-v1.json',
    );
    expect(msg).toContain('HTTP 403');
    expect(msg).toContain('code=accessDenied');
    expect(msg).not.toContain('organisation has no OneDrive');
  });

  it('keeps the licence coach line only for real licence errors', () => {
    const msg = formatGraphFailure(
      400,
      { code: 'BadRequest', message: 'Tenant does not have a SPO license.' },
      'garden-v1.json',
    );
    expect(msg).toContain('organisation has no OneDrive');
  });
});
