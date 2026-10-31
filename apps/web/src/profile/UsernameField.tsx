import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { handleStatusText, normalizeHandle, validateUsername, type AccountApi, type HandleStatus } from '@lovoki/core';

/** @handle input with a debounced availability check. The server repeats every rule and rate-limits the check. */
export function UsernameField({ api, value, onChange, error, current, hint }: { api: Pick<AccountApi, 'checkUsername'>; value: string; onChange: (v: string) => void; error?: string; current?: string | null; hint?: string }) {
  const id = useId();
  const [status, setStatus] = useState<HandleStatus | 'checking' | 'error' | null>(null);
  const seq = useRef(0);
  const h = normalizeHandle(value);
  const local = h ? validateUsername(h) : null;

  useEffect(() => {
    if (!h || local || h === current) { setStatus(null); return; }
    const my = ++seq.current; setStatus('checking');
    const t = setTimeout(() => {
      api.checkUsername(h).then((s) => { if (my === seq.current) setStatus(s); }).catch(() => { if (my === seq.current) setStatus('error'); });
    }, 350);
    return () => clearTimeout(t);
  }, [h, local, current, api]);

  const bad = error ?? (h && local ? local : status === 'unavailable' || status === 'invalid' || status === 'reserved' ? handleStatusText[status] : undefined);
  const ok = !bad && (status === 'available' || (!!h && h === current));
  return (
    <div className="field" data-invalid={!!bad}>
      <label htmlFor={id}>Username</label>
      <div className="row" style={{ gap: 0 }}>
        <span aria-hidden className="input" style={{ width: 'auto', flex: 'none', borderRight: 0, borderRadius: 'var(--radius-control) 0 0 var(--radius-control)', display: 'grid', placeItems: 'center', color: 'var(--c-text-muted)' }}>@</span>
        <input id={id} name="username" className="input" style={{ borderRadius: '0 var(--radius-control) var(--radius-control) 0' }} value={value} onChange={(e) => onChange(e.target.value.replace(/^@/, ''))}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" maxLength={31} aria-invalid={!!bad} aria-describedby={`${id}-s`} />
      </div>
      <div id={`${id}-s`} aria-live="polite" className="hint" style={{ minHeight: 20 }}>
        {bad ? <span className="field-error" style={{ margin: 0 }}><AlertCircle size={14} aria-hidden />{bad}</span>
          : status === 'checking' ? 'Checking…' : status === 'error' ? 'Couldn’t check just now. You can still continue; we check again when you save.'
          : ok ? <span style={{ color: 'var(--c-success, inherit)' }}><Check size={14} aria-hidden style={{ verticalAlign: -2 }} /> {h === current ? 'This is your username.' : 'Available.'}</span>
          : hint ?? '3 to 30 lowercase letters, numbers, dots or underscores. People find your profile at lovoki/@username.'}
      </div>
    </div>
  );
}
