import { AuthFailure } from './ports';

/* ---------- field validation ---------- */
export function validateEmail(v: string): string | null {
  const e = v.trim();
  if (!e) return 'Enter your email address.';
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Enter a valid email address.';
  return null;
}

export const PASSWORD_RULES = { min: 10, max: 72 } as const; // 72 = bcrypt byte limit used by Supabase

export function validatePassword(pw: string, email = ''): string | null {
  if (!pw) return 'Enter a password.';
  if (pw.length < PASSWORD_RULES.min) return `Use at least ${PASSWORD_RULES.min} characters.`;
  if (new TextEncoder().encode(pw).length > PASSWORD_RULES.max) return `Use ${PASSWORD_RULES.max} bytes or fewer.`;
  if (/^(.)\1+$/.test(pw)) return 'Choose a password with more variety.';
  const local = email.trim().split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 'Don’t include your email name in your password.';
  return null;
}

/* ---------- error mapping (raw SDK error -> safe, actionable copy) ---------- */
interface Raw { message?: string; status?: number; code?: string; name?: string }

const LINK_MSG = 'This link has expired, was already used, or was opened in a different browser than the one you signed up in.';

export function mapAuthError(e: unknown): AuthFailure {
  if (e instanceof AuthFailure) return e;
  const r: Raw = typeof e === 'object' && e ? (e as Raw) : {};
  const msg = (r.message ?? '').toLowerCase();
  const code = r.code ?? '';
  if (e instanceof TypeError || r.name === 'AuthRetryableFetchError' || r.status === 0 || /failed to fetch|networkerror|load failed|network request failed/.test(msg))
    return new AuthFailure('network', 'Can’t reach LOVOKI right now. Check your connection and try again.');
  if (code === 'invalid_credentials' || /invalid login credentials/.test(msg)) return new AuthFailure('invalid_credentials', 'Email or password is incorrect.');
  if (code === 'email_not_confirmed' || /email not confirmed/.test(msg)) return new AuthFailure('email_not_confirmed', 'Confirm your email first. We can send the link again.');
  if (code === 'weak_password' || /password should be|weak password/.test(msg)) return new AuthFailure('weak_password', 'Choose a stronger password. Use at least 10 characters.');
  if (code === 'captcha_failed' || /captcha/.test(msg)) return new AuthFailure('captcha', 'The check didn’t pass. Try again.');
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return new AuthFailure('recent_login_required', 'For your security, enter your current password to continue.');
  if (code === 'same_password') return new AuthFailure('same_password', 'Choose a password you haven’t used for this account.');
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/.test(msg)) return new AuthFailure('already_registered', 'That email can’t be used to create an account.');
  if (r.status === 429 || /rate limit|too many/.test(msg) || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || code === 'over_sms_send_rate_limit')
    return new AuthFailure('rate_limited', 'Too many attempts. Wait a minute, then try again.');
  if (['otp_expired', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier', 'bad_oauth_callback'].includes(code))
    return new AuthFailure('expired_link', LINK_MSG);
  if (['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt', 'no_authorization'].includes(code) || r.status === 401 || /jwt|session.*(missing|not found)|refresh token/.test(msg))
    return new AuthFailure('session_expired', 'Your session ended. Log in again to continue.');
  if (/invalid or has expired|code verifier|flow state|access_denied|(link|token|otp).*(invalid|expired)/.test(msg))
    return new AuthFailure('expired_link', LINK_MSG);
  return new AuthFailure('unknown', 'Something went wrong. Try again in a moment.');
}

/* ---------- redirect safety ---------- */
const ALLOWED = ['/discover', '/feed', '/connections', '/notifications', '/messages', '/me', '/settings', '/u', '/p', '/onboarding'];
/** A profile address: /@handle. */
const isHandlePath = (p: string) => /^\/@[a-z0-9._]{3,30}$/i.test(p);

/** Returns an internal, known application path (with query) or the fallback. Never an external or unknown URL. */
export function safeRedirect(next: string | null | undefined, fallback = '/discover'): string {
  if (!next || typeof next !== 'string' || next.length > 300) return fallback;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this check
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let u: URL;
  try { u = new URL(next, 'http://lovoki.invalid'); } catch { return fallback; }
  if (u.origin !== 'http://lovoki.invalid') return fallback;
  const p = u.pathname;
  return ALLOWED.some((a) => p === a || p.startsWith(a + '/')) || isHandlePath(p) ? p + u.search : fallback;
}

/** Where an email link may send the person: the reset form, or any allowed app path. */
export function safeCallbackNext(next: string | null | undefined): string {
  return next === '/reset-password' ? '/reset-password' : safeRedirect(next, '/onboarding');
}

/* ---------- route guard (pure, so it is unit-testable) ---------- */
export type RouteClass = 'root' | 'public-auth' | 'callback' | 'recovery' | 'onboarding' | 'app' | 'static' | 'unknown';
const PUBLIC_AUTH = ['/welcome', '/signup', '/login', '/forgot-password', '/check-email'];

export function classifyPath(path: string): RouteClass {
  if (path === '/') return 'root';
  if (path === '/terms' || path === '/privacy') return 'static';
  if (PUBLIC_AUTH.includes(path)) return 'public-auth';
  if (path === '/auth/callback') return 'callback';
  if (path === '/reset-password') return 'recovery';
  if (path === '/onboarding' || path.startsWith('/onboarding/')) return 'onboarding';
  if (ALLOWED.some((a) => path === a || path.startsWith(a + '/')) || isHandlePath(path)) return 'app';
  return 'unknown';
}

export interface GuardInput {
  mode: 'demo' | 'supabase';
  path: string; search?: string;
  auth: 'loading' | 'signed-out' | 'signed-in';
  emailConfirmed?: boolean;
  account: 'idle' | 'loading' | 'ready' | 'error';
  onboardingComplete: boolean | null;
}
export type Decision = { kind: 'wait' } | { kind: 'allow' } | { kind: 'redirect'; to: string } | { kind: 'account-error' };

export function decideRoute(i: GuardInput): Decision {
  const cls = classifyPath(i.path);
  const go = (to: string): Decision => ({ kind: 'redirect', to });
  if (cls === 'static') return { kind: 'allow' }; // the terms and privacy drafts are readable by anyone, signed in or not, in either mode
  if (i.mode === 'demo') return ['public-auth', 'callback', 'recovery', 'onboarding', 'root'].includes(cls) ? go('/discover') : { kind: 'allow' };
  if (cls === 'callback') return { kind: 'allow' };
  if (i.auth === 'loading') return { kind: 'wait' };
  if (i.auth === 'signed-out') {
    if (cls === 'public-auth' || cls === 'unknown') return { kind: 'allow' };
    if (cls === 'root') return go('/welcome');
    if (cls === 'recovery') return go('/forgot-password?expired=1');
    return go(`/login?next=${encodeURIComponent(safeRedirect(i.path + (i.search ?? ''), '/discover'))}`);
  }
  if (cls === 'unknown') return { kind: 'allow' };
  if (i.emailConfirmed === false && cls !== 'public-auth') return go('/check-email');
  if (cls === 'recovery') return { kind: 'allow' };
  if (i.account === 'idle' || i.account === 'loading') return { kind: 'wait' };
  if (i.account === 'error') return { kind: 'account-error' };
  const done = i.onboardingComplete === true;
  if (cls === 'public-auth' || cls === 'root') {
    if (!done) return go('/onboarding');
    // A validated ?next= survives login. Anything else falls back to the default destination.
    return go(safeRedirect(i.path === '/login' ? new URLSearchParams(i.search ?? '').get('next') : null, '/discover'));
  }
  if (cls === 'onboarding') return done ? go('/discover') : { kind: 'allow' };
  return done ? { kind: 'allow' } : go('/onboarding');
}
