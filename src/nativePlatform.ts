import { Capacitor } from '@capacitor/core';

/** True inside the Capacitor iOS (or Android) shell. False in the browser and in tests. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
