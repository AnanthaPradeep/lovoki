import { AccountFailure, AuthFailure } from './ports';

export const isNetworkError = (e: unknown): boolean =>
  e instanceof AuthFailure || e instanceof AccountFailure ? e.code === 'network' : e instanceof TypeError;

export interface RetryOptions { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; isRetryable?: (e: unknown) => boolean }

/** Retries only transient network failures, with exponential backoff. Use for idempotent reads, never for sign-up or sends. */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseMs = 300, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), isRetryable = isNetworkError } = o;
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      await sleep(baseMs * 2 ** attempt);
    }
  }
}
