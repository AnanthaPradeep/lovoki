import { describe, it, expect } from 'vitest';
import { evaluateConfig } from './config';

const jwt = (role: string) => `h.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.s`;

describe('data mode configuration', () => {
  it('defaults to demo when nothing asks for Supabase', () => {
    expect(evaluateConfig({})).toEqual({ mode: 'demo' });
    expect(evaluateConfig({ VITE_LOVOKI_MODE: 'demo', VITE_SUPABASE_URL: '' })).toEqual({ mode: 'demo' });
  });
  it('accepts a valid real configuration', () => {
    expect(evaluateConfig({ VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') }))
      .toEqual({ mode: 'supabase', url: 'https://abc.supabase.co', anonKey: jwt('anon') });
    expect(evaluateConfig({ VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }).mode).toBe('supabase');
  });
  it('does NOT fall back to demo when real mode is broken', () => {
    for (const env of [
      { VITE_LOVOKI_MODE: 'supabase' },
      { VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co' },
      { VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' },
      { VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_ANON_KEY: 'k' },
      { VITE_LOVOKI_MODE: 'prod' },
    ]) expect(evaluateConfig(env).mode, JSON.stringify(env)).toBe('error');
  });
  it('refuses service-role and secret keys in the browser', () => {
    const r = evaluateConfig({ VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(r.mode).toBe('error');
    expect(r.mode === 'error' && r.problems.join(' ')).toMatch(/service_role/);
    expect(evaluateConfig({ VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }).mode).toBe('error');
  });
  it('refuses secret-looking VITE_ variable names even in demo mode', () => {
    expect(evaluateConfig({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'x' }).mode).toBe('error');
    expect(evaluateConfig({ VITE_LOVOKI_MODE: 'demo', VITE_SECRET_THING: 'x' }).mode).toBe('error');
  });
  it('accepts the preferred publishable key name, the legacy anon name, and prefers the publishable one', () => {
    const base = { VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://abc.supabase.co' };
    expect(evaluateConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({ mode: 'supabase', url: 'https://abc.supabase.co', anonKey: 'sb_publishable_abc' });
    expect(evaluateConfig({ ...base, VITE_SUPABASE_ANON_KEY: jwt('anon') })).toEqual({ mode: 'supabase', url: 'https://abc.supabase.co', anonKey: jwt('anon') });
    expect(evaluateConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new', VITE_SUPABASE_ANON_KEY: jwt('anon') }))
      .toMatchObject({ mode: 'supabase', anonKey: 'sb_publishable_new' });
  });
  it('names the right variable when a secret is put in either key slot', () => {
    const base = { VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: 'https://abc.supabase.co' };
    const a = evaluateConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }); const b = evaluateConfig({ ...base, VITE_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(a.mode === 'error' && a.problems.join(' ')).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret/);
    expect(b.mode === 'error' && b.problems.join(' ')).toMatch(/VITE_SUPABASE_ANON_KEY is a service_role/);
    expect(evaluateConfig({ ...base }).mode).toBe('error');
  });
  it('rejects any VITE_ variable that smells like a secret, including a captcha secret', () => {
    const r = evaluateConfig({ VITE_LOVOKI_MODE: 'demo', VITE_CAPTCHA_SECRET_KEY: 'x' });
    expect(r.mode).toBe('error');
  });
  it('a captcha SITE key (public) is allowed', () => { expect(evaluateConfig({ VITE_LOVOKI_MODE: 'demo', VITE_CAPTCHA_SITE_KEY: '1x00000000000000000000AA' }).mode).toBe('demo'); });
});
