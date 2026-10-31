import type { Account, AccountPhoto, AboutInput, BasicsSave, DatingProfileInput, PreferencesInput, PrivacyInput, Step, AllowComments } from './account';
import type { AvatarCrop, DatingFilters, PlaceHit } from './dating';
import type { HandleStatus, ProfileDetails, VisibilityMap } from './profile';

export type AuthErrorCode =
  | 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'weak_password' | 'same_password'
  | 'already_registered' | 'expired_link' | 'session_expired' | 'network' | 'captcha' | 'recent_login_required' | 'unknown';

export class AuthFailure extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) { super(message); this.name = 'AuthFailure'; this.code = code; }
}

export interface AuthUser { id: string; email: string | null; emailConfirmed: boolean }

/** What a person agrees to at sign-up. The database records it with its own clock when the account is created. */
export interface SignUpConsent { termsVersion: string; confirm18: boolean; marketing: boolean }
export interface SignUpOptions { captchaToken?: string; consent?: SignUpConsent }
/** What the browser knows about the current session. No device list exists, so none is invented. */
export interface SessionInfo { email: string | null; provider: string; lastSignInAt: string | null; expiresAt: string | null; pendingEmail: string | null }

/** Authentication port. Implemented by SupabaseAuthApi (apps/web/src/data) and FakeAuthApi (tests). */
export interface AuthApi {
  /** Restores a stored session and verifies it with the server where possible. null = signed out. */
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (user: AuthUser | null, event: string) => void): () => void;
  /** Resolves the same way for new and already-registered addresses so the UI can stay neutral. */
  signUp(email: string, password: string, options?: SignUpOptions): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  requestPasswordReset(email: string, captchaToken?: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Re-authenticates with the current password first, then sets the new one. */
  changePassword(current: string, next: string): Promise<void>;
  /** Asks for a new address. The change only happens after the link sent to the NEW address is opened. */
  changeEmail(newEmail: string): Promise<void>;
  /** Ends this session and every other session of this account, on every device. */
  signOutEverywhere(): Promise<void>;
  sessionInfo(): Promise<SessionInfo | null>;
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
  saveBasics(i: BasicsSave): Promise<void>;
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
  savePlace(placeId: number): Promise<void>;
  clearPlace(): Promise<void>;
  saveFilters(f: DatingFilters): Promise<void>;
  /** Phase 3.5. */
  checkUsername(handle: string): Promise<HandleStatus>;
  setUsername(handle: string): Promise<void>;
  searchPlaces(query: string): Promise<PlaceHit[]>;
  /** The browser sends one point after an explicit click; only the chosen place is ever saved. */
  nearestPlaces(lat: number, lng: number): Promise<PlaceHit[]>;
  saveDetails(details: ProfileDetails, visibility: VisibilityMap, opts: { religionOptIn: boolean }): Promise<void>;
  saveAvatar(photoId: string | null, crop: AvatarCrop | null, blurhash?: string | null): Promise<void>;
  saveSocialSettings(s: { allowComments: AllowComments; showFollowerCounts: boolean; searchable: boolean; showAvatarToEveryone: boolean }): Promise<void>;
  /** The account-level private/public switch. Private hides posts, media and the lists from non-followers. */
  setAccountPrivate(isPrivate: boolean): Promise<void>;
  recordConsent(termsVersion: string, marketing?: boolean): Promise<void>;
  setMarketingConsent(on: boolean): Promise<void>;
}
