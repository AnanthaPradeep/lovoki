import type { Account, AccountPhoto, AboutInput, BasicsInput, DatingProfileInput, PreferencesInput, PrivacyInput, Step } from './account';
import type { DatingFilters, Place } from './dating';

export type AuthErrorCode =
  | 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'weak_password' | 'same_password'
  | 'already_registered' | 'expired_link' | 'session_expired' | 'network' | 'unknown';

export class AuthFailure extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) { super(message); this.name = 'AuthFailure'; this.code = code; }
}

export interface AuthUser { id: string; email: string | null; emailConfirmed: boolean }

/** Authentication port. Implemented by SupabaseAuthApi (apps/web/src/data) and FakeAuthApi (tests). */
export interface AuthApi {
  /** Restores a stored session and verifies it with the server where possible. null = signed out. */
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (user: AuthUser | null, event: string) => void): () => void;
  /** Resolves the same way for new and already-registered addresses so the UI can stay neutral. */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Finishes an email-link callback (confirmation or recovery) from the full page URL. */
  completeCallback(href: string): Promise<{ next: string | null }>;
}

export type AccountErrorCode = 'under_18' | 'dob_locked' | 'onboarding_incomplete' | 'invalid' | 'photo_limit' | 'unauthorized' | 'network' | 'unknown';

export class AccountFailure extends Error {
  readonly code: AccountErrorCode;
  readonly missing: string[];
  constructor(code: AccountErrorCode, message: string, missing: string[] = []) { super(message); this.name = 'AccountFailure'; this.code = code; this.missing = missing; }
}

/** Persistence port for the signed-in user's own profile. Screens depend on this, never on the SDK. */
export interface AccountApi {
  load(): Promise<Account>;
  saveBasics(i: BasicsInput): Promise<void>;
  saveAbout(i: AboutInput): Promise<void>;
  savePreferences(i: PreferencesInput): Promise<void>;
  savePrivacy(i: PrivacyInput): Promise<void>;
  setStep(step: Step): Promise<void>;
  /** Receives an already-processed image. Validates type and size again, then stores and registers it. */
  uploadPhoto(image: Blob): Promise<AccountPhoto>;
  reorderPhotos(orderedIds: string[]): Promise<void>;
  deletePhoto(id: string): Promise<void>;
  /** Short-lived authorized URL for a private photo. */
  photoUrl(path: string): Promise<string>;
  completeOnboarding(): Promise<string>;
  /** Phase 4: gender and display flags, the rounded place, and the soft discovery filters. */
  saveDatingProfile(i: DatingProfileInput): Promise<void>;
  savePlace(p: Place): Promise<void>;
  clearPlace(): Promise<void>;
  saveFilters(f: DatingFilters): Promise<void>;
}
