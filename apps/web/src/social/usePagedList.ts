import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { emptyList, postsReducer, SocialFailure, type ListState, type Page, type PostAction, type PostView } from '@lovoki/core';

export type LoadStatus = 'loading' | 'ready' | 'error';
const errorText = (e: unknown) => (e instanceof SocialFailure ? e.message : 'Something went wrong. Try again.');

/**
 * Keyset-paged post list. `key` identifies the list (tab, author…): a change resets and reloads.
 * Late responses from an older key or an older click are ignored (the `seq` guard).
 */
export function usePostList(load: (cursor: string | null) => Promise<Page<PostView>>, key: string, enabled = true) {
  const [state, dispatch] = useReducer(postsReducer, undefined, emptyList<PostView>);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [more, setMore] = useState<LoadStatus | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load); loadRef.current = load;

  const first = useCallback(() => {
    const my = ++seq.current;
    setStatus('loading'); setError(null); setMore('idle');
    loadRef.current(null)
      .then((page) => { if (my === seq.current) { dispatch({ type: 'replace', page }); setStatus('ready'); } })
      .catch((e) => { if (my === seq.current) { setError(errorText(e)); setStatus('error'); } });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the counter on cleanup is the point: it invalidates in-flight responses
  useEffect(() => { if (enabled) first(); return () => { seq.current++; }; }, [key, enabled, first]);

  const loadMore = useCallback(() => {
    if (!state.next || more === 'loading') return;
    const my = seq.current; setMore('loading'); setError(null);
    loadRef.current(state.next)
      .then((page) => { if (my === seq.current) { dispatch({ type: 'append', page }); setMore('idle'); } })
      .catch((e) => { if (my === seq.current) { setError(errorText(e)); setMore('error'); } });
  }, [state.next, more]);

  return { state, dispatch: dispatch as (a: PostAction) => void, status, more, error, reload: first, loadMore };
}

/** Same idea for non-post lists (people, notifications, comments) that only append. */
export function usePageList<T extends { id?: string; cursor: string }>(load: (cursor: string | null) => Promise<Page<T>>, key: string, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [more, setMore] = useState<LoadStatus | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load); loadRef.current = load;

  const first = useCallback(() => {
    const my = ++seq.current;
    setStatus('loading'); setError(null); setMore('idle');
    loadRef.current(null)
      .then((p) => { if (my === seq.current) { setItems(p.items); setNext(p.next); setStatus('ready'); } })
      .catch((e) => { if (my === seq.current) { setError(errorText(e)); setStatus('error'); } });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the counter on cleanup is the point: it invalidates in-flight responses
  useEffect(() => { if (enabled) first(); return () => { seq.current++; }; }, [key, enabled, first]);

  const loadMore = useCallback(() => {
    if (!next || more === 'loading') return;
    const my = seq.current; setMore('loading'); setError(null);
    loadRef.current(next)
      .then((p) => { if (my === seq.current) { setItems((cur) => { const seen = new Set(cur.map((c) => c.cursor)); return [...cur, ...p.items.filter((i) => !seen.has(i.cursor))]; }); setNext(p.next); setMore('idle'); } })
      .catch((e) => { if (my === seq.current) { setError(errorText(e)); setMore('error'); } });
  }, [next, more]);

  return { items, setItems, next, status, more, error, reload: first, loadMore };
}
export { errorText };
export type { ListState };
