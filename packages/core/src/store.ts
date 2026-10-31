import type { AppState, Comment, Filters, Photo, PrivacySettings, Profile, ThemePreference, Audience } from './types';
import { reduce, type Action, canMessage, newPost, LIMITS } from './logic';
import { seedState } from './seed';

/**
 * Backend boundary. Phase 1 ships MockLovokiApi (local, nothing transmitted).
 * Phase 2+ swap in a Supabase-backed implementation without touching screens.
 */
export interface LovokiApi {
  like(profileId: string): Promise<{ matched: boolean }>;
  sendMessage(profileId: string, text: string): Promise<void>;
  publishPost(caption: string, photo: Photo | null, audience: Audience): Promise<void>;
  report(profileId: string, reason: string, details: string): Promise<void>;
}

export interface StorageAdapter { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }

export const memoryStorage = (): StorageAdapter => {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } };
};

const KEY = 'lovoki.demo.v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export class DemoFailure extends Error { constructor() { super('Demo network failure'); } }

export interface StoreStatus { hydrated: boolean; simulateFailures: boolean }

export class LovokiStore {
  private state: AppState;
  private listeners = new Set<() => void>();
  status: StoreStatus = { hydrated: false, simulateFailures: false };
  readonly api: LovokiApi;

  constructor(private storage: StorageAdapter, private latencyMs = 450, initial?: AppState) {
    this.state = initial ?? seedState();
    // Mock API: operates only on local state; latency and optional failure simulate a network.
    this.api = {
      like: async (pid) => { await this.net(); this.dispatch({ type: 'like', profileId: pid, now: Date.now() }); return { matched: this.state.matches.some((m) => m.profileId === pid) }; },
      sendMessage: async () => { await this.net(); },
      publishPost: async (caption, photo, audience) => { await this.net(); this.dispatch({ type: 'publishPost', post: newPost(id('post'), caption, photo, audience, Date.now()) }); },
      report: async (pid, reason, details) => { await this.net(); this.dispatch({ type: 'report', profileId: pid, reason, details, id: id('report'), now: Date.now() }); },
    };
  }

  private async net() {
    await sleep(this.latencyMs);
    if (this.status.simulateFailures) throw new DemoFailure();
  }

  async hydrate() {
    try {
      const raw = await this.storage.get(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { state: AppState; simulateFailures?: boolean };
        if (parsed.state?.version === 1) this.state = parsed.state;
        this.status = { ...this.status, simulateFailures: !!parsed.simulateFailures };
      }
    } catch { /* corrupted storage falls back to seed */ }
    this.status = { ...this.status, hydrated: true };
    this.emit();
  }

  getState = () => this.state;
  getStatus = () => this.status;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  private emit() { this.listeners.forEach((l) => l()); }
  private persist() { void this.storage.set(KEY, JSON.stringify({ state: this.state, simulateFailures: this.status.simulateFailures })); }

  dispatch(a: Action) {
    const next = reduce(this.state, a);
    if (next !== this.state) { this.state = next; this.persist(); this.emit(); }
  }

  /* ---- intent methods used by both apps ---- */
  like = (pid: string) => this.api.like(pid);
  pass = (pid: string) => this.dispatch({ type: 'pass', profileId: pid });
  unmatch = (pid: string) => this.dispatch({ type: 'unmatch', profileId: pid });
  follow = (pid: string) => this.dispatch({ type: 'follow', profileId: pid });
  unfollow = (pid: string) => this.dispatch({ type: 'unfollow', profileId: pid });
  togglePostLike = (postId: string) => this.dispatch({ type: 'togglePostLike', postId });
  togglePostSave = (postId: string) => this.dispatch({ type: 'togglePostSave', postId });
  addComment = (postId: string, text: string) => {
    const t = text.trim().slice(0, LIMITS.comment);
    if (!t) return;
    const comment: Comment = { id: id('c'), authorId: 'me', text: t, createdAt: Date.now() };
    this.dispatch({ type: 'addComment', postId, comment });
  };
  publishPost = (caption: string, photo: Photo | null, audience: Audience) => this.api.publishPost(caption, photo, audience);
  block = (pid: string) => this.dispatch({ type: 'block', profileId: pid });
  unblock = (pid: string) => this.dispatch({ type: 'unblock', profileId: pid });
  report = (pid: string, reason: string, details: string) => this.api.report(pid, reason, details);
  updateProfile = (patch: Partial<Profile>) => this.dispatch({ type: 'updateProfile', patch });
  setFilters = (filters: Filters) => this.dispatch({ type: 'setFilters', filters });
  setPrivacy = (privacy: Partial<PrivacySettings>) => this.dispatch({ type: 'setPrivacy', privacy });
  setTheme = (theme: ThemePreference) => this.dispatch({ type: 'setTheme', theme });
  markRead = (pid: string) => this.dispatch({ type: 'markRead', profileId: pid });

  /** Optimistic send: message appears as "sending", then delivered or failed (retryable). */
  async sendMessage(pid: string, text: string) {
    const t = text.trim();
    if (!t || t.length > LIMITS.message || !canMessage(this.state, pid)) return;
    const mid = id('m');
    this.dispatch({ type: 'addMessage', profileId: pid, id: mid, text: t, now: Date.now() });
    await this.deliver(pid, mid, t);
  }
  async retryMessage(pid: string, mid: string) {
    const m = this.state.conversations[pid]?.messages.find((x) => x.id === mid);
    if (m) await this.deliver(pid, mid, m.text);
  }
  private async deliver(pid: string, mid: string, text: string) {
    this.dispatch({ type: 'setDelivery', profileId: pid, id: mid, delivery: 'sending' });
    try { await this.api.sendMessage(pid, text); this.dispatch({ type: 'setDelivery', profileId: pid, id: mid, delivery: 'delivered' }); }
    catch { this.dispatch({ type: 'setDelivery', profileId: pid, id: mid, delivery: 'failed' }); }
  }

  setSimulateFailures(on: boolean) { this.status = { ...this.status, simulateFailures: on }; this.persist(); this.emit(); }

  async resetDemo() {
    await this.storage.remove(KEY);
    this.status = { ...this.status, simulateFailures: false };
    this.dispatch({ type: 'replace', state: seedState() });
    this.persist();
  }
}
