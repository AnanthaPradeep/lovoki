import type { EmailOtpType, SupabaseClient, User } from '@supabase/supabase-js';
import { AuthFailure, mapAuthError, type AuthApi, type AuthUser } from '@lovoki/core';

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? null, emailConfirmed: !!u.email_confirmed_at } : null);
const OTP_TYPES: EmailOtpType[] = ['signup', 'recovery', 'email', 'invite', 'magiclink', 'email_change'];

export class SupabaseAuthApi implements AuthApi {
  constructor(private sb: SupabaseClient, private origin: string = window.location.origin) {}

  /** Must be listed under Authentication > URL Configuration > Redirect URLs. */
  private callback(next: string) { return `${this.origin}/auth/callback?next=${encodeURIComponent(next)}`; }

  async getUser(): Promise<AuthUser | null> {
    const { data, error } = await this.sb.auth.getSession();
    if (error) throw mapAuthError(error);
    if (!data.session) return null;
    // A stored session can be revoked or expired: confirm with the server.
    const { error: verifyError } = await this.sb.auth.getUser();
    if (verifyError) {
      const f = mapAuthError(verifyError);
      if (f.code === 'network') return toUser(data.session.user); // offline: keep going, the account load will surface the problem
      await this.sb.auth.signOut({ scope: 'local' });
      throw f.code === 'unknown' ? new AuthFailure('session_expired', f.message) : f;
    }
    return toUser(data.session.user);
  }

  onChange(cb: (user: AuthUser | null, event: string) => void) {
    // Deferred: calling Supabase methods synchronously inside this callback can deadlock the client.
    const { data } = this.sb.auth.onAuthStateChange((event, session) => { setTimeout(() => cb(toUser(session?.user), event), 0); });
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: this.callback('/onboarding') } });
    if (error) {
      const f = mapAuthError(error);
      if (f.code === 'already_registered') return { needsConfirmation: true }; // do not reveal that the address exists
      throw f;
    }
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw mapAuthError(error);
    return toUser(data.user)!;
  }

  async signOut() {
    const { error } = await this.sb.auth.signOut({ scope: 'local' });
    if (error && mapAuthError(error).code !== 'session_expired') throw mapAuthError(error);
  }

  async resendConfirmation(email: string) {
    const { error } = await this.sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: this.callback('/onboarding') } });
    if (error) throw mapAuthError(error);
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: this.callback('/reset-password') });
    if (error) throw mapAuthError(error);
  }

  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw mapAuthError(error);
  }

  async completeCallback(href: string) {
    const url = new URL(href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const get = (k: string) => url.searchParams.get(k) ?? hash.get(k);
    const err = get('error'), errCode = get('error_code');
    if (err || errCode) throw mapAuthError({ code: errCode ?? err ?? undefined, message: get('error_description') ?? err ?? '' });
    const code = url.searchParams.get('code'), tokenHash = get('token_hash'), type = get('type');
    if (code) {
      const { error } = await this.sb.auth.exchangeCodeForSession(code);
      if (error) throw mapAuthError(error);
    } else if (tokenHash && type && (OTP_TYPES as string[]).includes(type)) {
      const { error } = await this.sb.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
      if (error) throw mapAuthError(error);
    } else {
      throw new AuthFailure('expired_link', 'This link is incomplete. Request a new one.');
    }
    return { next: url.searchParams.get('next') };
  }
}
