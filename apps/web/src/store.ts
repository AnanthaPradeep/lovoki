import { useSyncExternalStore } from 'react';
import { LovokiStore, type AppState, type StorageAdapter } from '@lovoki/core';

const local: StorageAdapter = {
  async get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: session-only */ } },
  async remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const store = new LovokiStore(local);
void store.hydrate();

/** Whole state (stable reference until it changes). Derive with useMemo in components. */
export const useAppState = (): AppState => useSyncExternalStore(store.subscribe, store.getState);
export const useStatus = () => useSyncExternalStore(store.subscribe, store.getStatus);
