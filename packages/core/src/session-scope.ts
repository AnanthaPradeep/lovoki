/** Registry of everything that holds a signed-in user's data, so logout can clear all of it in one call. */
export class UserScope {
  private cleaners = new Map<string, () => void>();
  register(name: string, clear: () => void): () => void {
    this.cleaners.set(name, clear);
    return () => { this.cleaners.delete(name); };
  }
  /** Runs every cleaner. A failing cleaner never stops the others. Returns the names that failed. */
  clearAll(): string[] {
    const failed: string[] = [];
    for (const [name, fn] of this.cleaners) { try { fn(); } catch { failed.push(name); } }
    return failed;
  }
}

export interface KeyedStorage { readonly length: number; key(i: number): string | null; removeItem(k: string): void }
export const USER_STORAGE_PREFIX = 'lovoki.user.';

/** Removes every storage key under a prefix (user-scoped keys only, so demo data and UI prefs survive). */
export function clearStoragePrefix(s: KeyedStorage, prefix = USER_STORAGE_PREFIX): number {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(prefix)) keys.push(k); }
  keys.forEach((k) => s.removeItem(k));
  return keys.length;
}
