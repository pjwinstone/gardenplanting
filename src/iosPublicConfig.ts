/**
 * Confirmed iOS identity. The Entra redirect is a public-client (iOS) URI.
 * It is not an SPA redirect. MSAL in the browser cannot use this scheme.
 * Keep the same string in ios/App/App/Info.plist and GardenAuthPlugin.swift.
 */
export const IOS_BUNDLE_ID = 'com.pjwinstone.gardenplanting';

/** Exact redirect Paul adds on the existing Entra app registration. */
export const IOS_ENTRA_REDIRECT_URI = 'msauth.com.pjwinstone.gardenplanting://auth';

export const IOS_URL_SCHEME = 'msauth.com.pjwinstone.gardenplanting';

export const IOS_APP_NAME = 'Garden Planting';
