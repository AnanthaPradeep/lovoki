import { UserScope, clearStoragePrefix } from '@lovoki/core';

/** Everything that holds a signed-in person's data registers here, so logout clears it all in one call. */
export const userScope = new UserScope();

export function clearUserData(): string[] {
  try { clearStoragePrefix(localStorage); clearStoragePrefix(sessionStorage); } catch { /* storage unavailable */ }
  return userScope.clearAll();
}
