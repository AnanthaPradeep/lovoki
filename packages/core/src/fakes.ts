import { dobError, ageOn, todayLocalIso } from './age';
import { missingRequired, validateAbout, validateBasics, validatePreferences, interestLabel, stepIndex, type Account, type AccountPhoto, type Step } from './account';
import { validatePhotoInput, validateStoredPhoto, PHOTO_RULES } from './photos';
import { AccountFailure, AuthFailure, type AccountApi, type AccountErrorCode, type AuthApi, type AuthErrorCode, type AuthUser, type SessionInfo, type SignUpOptions } from './ports';
import { validateEmail, validatePassword } from './auth';
import { photoDataUri } from './art';
import type { AvatarCrop, DatingFilters, PlaceHit } from './dating';
import { DETAIL_LIMITS, RESERVED_HANDLES, emptyDetails, normalizeHandle, validateDetails, validateUsername, type HandleStatus, type ProfileDetails, type VisibilityMap } from './profile';
import { fakeNearestPlaces, fakePlaceById, fakeSearchPlaces } from './fake-places';

/* In-memory implementations used by MOCKED tests only. They are not evidence about Supabase behaviour. */

export class FakeAuthApi implements AuthApi {
  users = new Map<string, { id: string; password: string; confirmed: boolean; pendingEmail?: string; lastSignInAt?: string }>();
  /** When true, sign-up and password reset need a captcha token, like a project with CAPTCHA switched on. */
  captchaRequired = false;
  lastSignUp: { email: string; options?: SignUpOptions } | null = null;
  /** What the server's sign-up trigger would have recorded from the sign-up metadata (keyed by email). */
  consents = new Map<string, { termsVersion: string; marketing: boolean }>();
  globalSignOuts = 0;
  current: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null, e: string) => void>();
  private fail: { code: AuthErrorCode; times: number } | null = null;
  calls: string[] = [];
  failNext(code: AuthErrorCode, times = 1) { this.fail = { code, times }; }
  latencyMs = 0;
  private async maybeFail(name: string) {
    this.calls.push(name);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.fail && this.fail.times > 0) { this.fail.times--; throw new AuthFailure(this.fail.code, `fake ${this.fail.code}`); }
  }
  private emit(e: string) { this.listeners.forEach((l) => l(this.current, e)); }
  confirm(email: string) { const u = this.users.get(email.toLowerCase()); if (u) u.confirmed = true; }
  async getUser() { await this.maybeFail('getUser'); return this.current; }
  onChange(cb: (u: AuthUser | null, e: string) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  async signUp(email: string, password: string, options?: SignUpOptions) {
    await this.maybeFail('signUp');
    if (this.captchaRequired && !options?.captchaToken) throw new AuthFailure('captcha', 'Complete the check to continue.');
    this.lastSignUp = { email: email.toLowerCase(), options };
    if (validateEmail(email) || validatePassword(password, email)) throw new AuthFailure('weak_password', 'weak');
    const key = email.toLowerCase();
    if (!this.users.has(key)) {
      this.users.set(key, { id: crypto.randomUUID(), password, confirmed: false });
      const c = options?.consent; if (c) this.consents.set(key, { termsVersion: c.termsVersion, marketing: !!c.marketing });
    }
    return { needsConfirmation: true }; // identical for new and existing addresses
  }
  async signIn(email: string, password: string) {
    await this.maybeFail('signIn');
    const u = this.users.get(email.toLowerCase());
    if (!u || u.password !== password) throw new AuthFailure('invalid_credentials', 'Email or password is incorrect.');
    if (!u.confirmed) throw new AuthFailure('email_not_confirmed', 'Confirm your email first.');
    this.current = { id: u.id, email: email.toLowerCase(), emailConfirmed: true };
    u.lastSignInAt = new Date().toISOString();
    this.emit('SIGNED_IN');
    return this.current;
  }
  async signOut() { await this.maybeFail('signOut'); this.current = null; this.emit('SIGNED_OUT'); }
  async resendConfirmation() { await this.maybeFail('resend'); }
  async requestPasswordReset(_email?: string, captchaToken?: string) {
    await this.maybeFail('reset');
    if (this.captchaRequired && !captchaToken) throw new AuthFailure('captcha', 'Complete the check to continue.');
  }
  private me() { const u = this.current && [...this.users.values()].find((x) => x.id === this.current!.id); if (!this.current || !u) throw new AuthFailure('session_expired', 'Your session ended.'); return u; }
  async changePassword(current: string, next: string) {
    await this.maybeFail('changePassword');
    const u = this.me();
    if (u.password !== current) throw new AuthFailure('invalid_credentials', 'Your current password is incorrect.');
    if (validatePassword(next, this.current!.email ?? '')) throw new AuthFailure('weak_password', 'weak');
    if (next === current) throw new AuthFailure('same_password', 'same');
    u.password = next;
  }
  async changeEmail(newEmail: string) {
    await this.maybeFail('changeEmail');
    const u = this.me();
    if (validateEmail(newEmail)) throw new AuthFailure('unknown', 'Enter a valid email address.');
    u.pendingEmail = newEmail.trim().toLowerCase(); // nothing changes until the link sent to the new address is opened
  }
  /** Test helper: the person opened the link in the new inbox. */
  confirmEmailChange() {
    const u = this.me(); if (!u.pendingEmail) return;
    for (const [k, v] of this.users) if (v === u) this.users.delete(k);
    this.users.set(u.pendingEmail, u); this.current = { ...this.current!, email: u.pendingEmail }; u.pendingEmail = undefined;
  }
  async signOutEverywhere() { await this.maybeFail('signOutEverywhere'); this.globalSignOuts++; this.current = null; this.emit('SIGNED_OUT'); }
  async sessionInfo(): Promise<SessionInfo | null> {
    await this.maybeFail('sessionInfo');
    if (!this.current) return null;
    const u = this.me();
    return { email: this.current.email, provider: 'email', lastSignInAt: u.lastSignInAt ?? null, expiresAt: new Date(Date.now() + 3600_000).toISOString(), pendingEmail: u.pendingEmail ?? null };
  }
  async updatePassword(password: string) {
    await this.maybeFail('updatePassword');
    if (!this.current) throw new AuthFailure('session_expired', 'Your session ended.');
    if (validatePassword(password, this.current.email ?? '')) throw new AuthFailure('weak_password', 'weak');
    const u = [...this.users.values()].find((x) => x.id === this.current!.id)!;
    if (u.password === password) throw new AuthFailure('same_password', 'same');
    u.password = password;
  }
  /** A fake link carries code=ok:<email>. Anything else behaves like an expired or reused link. */
  async completeCallback(href: string) {
    await this.maybeFail('callback');
    const url = new URL(href);
    const m = /^ok:(.+)$/.exec(url.searchParams.get('code') ?? '');
    const email = m?.[1]?.toLowerCase();
    const user = email ? this.users.get(email) : undefined;
    if (!email || !user) throw new AuthFailure('expired_link', 'This link has expired, was already used, or was opened in a different browser.');
    user.confirmed = true;
    this.current = { id: user.id, email, emailConfirmed: true };
    this.emit('SIGNED_IN');
    return { next: url.searchParams.get('next') };
  }
}

const fail = (code: AccountErrorCode, msg: string, missing: string[] = []) => new AccountFailure(code, msg, missing);

export class FakeAccountApi implements AccountApi {
  account: Account;
  calls: string[] = [];
  private failing: { code: AccountErrorCode; times: number } | null = null;
  today = todayLocalIso();
  constructor(userId: string = crypto.randomUUID(), email: string | null = 'a@example.com') {
    this.account = {
      userId, email, displayName: '', pronouns: '', dateOfBirth: null, age: null, bio: '', interests: [], prompts: [],
      intention: null, interestedIn: [], ageMin: 18, ageMax: 60, maxDistanceKm: null, areaLabel: '',
      socialVisibility: 'public', datingDiscoverable: false, photos: [], onboarding: { currentStep: 'basics', completedAt: null },
      username: null, gender: null, genderCustom: null, showGender: true, showDistance: true, place: null, avatarPhotoId: null, avatarCrop: null,
      details: emptyDetails(), visibility: {}, allowComments: 'everyone', showFollowerCounts: true, searchable: true, showAvatarToEveryone: false, avatarBlurhash: null, isSample: false, consent: null,
      filterIntentions: [], filterInterests: [], filterHeightMin: null, filterHeightMax: null, filterDrinking: [], filterSmoking: [], filterKids: [],
    };
  }
  failNext(code: AccountErrorCode, times = 1) { this.failing = { code, times }; }
  latencyMs = 0;
  private async gate(name: string) {
    this.calls.push(name);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failing && this.failing.times > 0) { this.failing.times--; throw fail(this.failing.code, `fake ${this.failing.code}`); }
  }
  async load() { await this.gate('load'); return structuredClone(this.account); }
  async saveBasics(i: Parameters<AccountApi['saveBasics']>[0]) {
    await this.gate('saveBasics');
    const locked = !!this.account.onboarding.completedAt && !!this.account.dateOfBirth;
    if (locked && i.dateOfBirth !== this.account.dateOfBirth) throw fail('dob_locked', 'Date of birth can’t be changed after onboarding.');
    const dobErr = locked ? null : dobError(i.dateOfBirth, this.today);
    if (dobErr?.includes('18')) throw fail('under_18', dobErr);
    if (Object.keys(validateBasics({ ...i, username: '', gender: '', genderCustom: '' }, this.today, locked, { requireIdentity: false })).length) throw fail('invalid', 'Invalid basics.');
    Object.assign(this.account, { displayName: i.displayName.trim(), pronouns: i.pronouns.trim(), dateOfBirth: i.dateOfBirth, age: ageOn(i.dateOfBirth, this.today) });
  }
  async saveAbout(i: Parameters<AccountApi['saveAbout']>[0]) {
    await this.gate('saveAbout');
    if (Object.keys(validateAbout(i)).length) throw fail('invalid', 'Invalid about.');
    Object.assign(this.account, { bio: i.bio.trim(), interests: i.interests.map((x) => interestLabel(x.toLowerCase().replace(/[^a-z0-9]+/g, '-')) ?? x), prompts: i.prompts.map((p) => ({ question: p.question, answer: p.answer.trim() })) });
  }
  async savePreferences(i: Parameters<AccountApi['savePreferences']>[0]) {
    await this.gate('savePreferences');
    if (Object.keys(validatePreferences(i)).length) throw fail('invalid', 'Invalid preferences.');
    Object.assign(this.account, { intention: i.intention, interestedIn: i.interestedIn, ageMin: i.ageMin, ageMax: i.ageMax, maxDistanceKm: i.maxDistanceKm });
  }
  async savePrivacy(i: Parameters<AccountApi['savePrivacy']>[0]) {
    await this.gate('savePrivacy');
    if (!i.areaLabel.trim()) throw fail('invalid', 'Choose your city.');
    Object.assign(this.account, { areaLabel: i.areaLabel.trim(), socialVisibility: i.socialVisibility, datingDiscoverable: i.datingDiscoverable });
  }
  async setStep(step: Step) {
    await this.gate('setStep');
    if (!this.account.onboarding.completedAt && stepIndex(step) >= 0) this.account.onboarding.currentStep = step;
  }
  async uploadPhoto(image: Blob): Promise<AccountPhoto> {
    await this.gate('uploadPhoto');
    const bad = validateStoredPhoto(image) ?? validatePhotoInput(image);
    if (bad) throw fail('invalid', bad);
    if (this.account.photos.length >= PHOTO_RULES.maxCount) throw fail('photo_limit', `You can add up to ${PHOTO_RULES.maxCount} photos.`);
    const id = crypto.randomUUID();
    const p: AccountPhoto = { id, path: `${this.account.userId}/${id}.jpg`, position: this.account.photos.length, contentType: image.type, sizeBytes: image.size };
    this.account.photos.push(p);
    return p;
  }
  async reorderPhotos(ids: string[]) {
    await this.gate('reorderPhotos');
    const have = this.account.photos.map((p) => p.id).sort().join();
    if ([...ids].sort().join() !== have) throw fail('invalid', 'Photo list changed. Reload and try again.');
    this.account.photos = ids.map((id, position) => ({ ...this.account.photos.find((p) => p.id === id)!, position }));
  }
  async deletePhoto(id: string) {
    await this.gate('deletePhoto');
    this.account.photos = this.account.photos.filter((p) => p.id !== id).map((p, position) => ({ ...p, position }));
  }
  async photoUrl(path: string) { let h = 0; for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0; return photoDataUri(h % 90); }
  /** Shared by every fake account in this process, so uniqueness can be tested across people. */
  static handles = new Map<string, string>();
  usernameChangedAt: number | null = null;
  async saveDatingProfile(i: Parameters<AccountApi['saveDatingProfile']>[0]) {
    await this.gate('saveDatingProfile');
    if (!['woman', 'man', 'non-binary', 'self-describe'].includes(i.gender)) throw fail('invalid', 'Choose a gender.');
    if (i.gender === 'self-describe' && !(i.genderCustom ?? '').trim()) throw fail('invalid', 'Tell us how you describe your gender.');
    Object.assign(this.account, { gender: i.gender, genderCustom: i.gender === 'self-describe' ? i.genderCustom!.trim() : null, showGender: i.showGender, showDistance: i.showDistance });
  }
  async checkUsername(handle: string): Promise<HandleStatus> {
    await this.gate('checkUsername');
    const h = normalizeHandle(handle);
    const bad = validateUsername(h);
    if (bad) return RESERVED_HANDLES.includes(h) ? 'reserved' : 'invalid';
    const owner = FakeAccountApi.handles.get(h);
    return owner && owner !== this.account.userId ? 'unavailable' : 'available';
  }
  async setUsername(handle: string) {
    await this.gate('setUsername');
    const h = normalizeHandle(handle); const st = await this.checkUsername(h);
    if (st !== 'available') throw fail('invalid', st === 'unavailable' ? 'That username isn’t available.' : 'Choose a valid username.');
    const done = !!this.account.onboarding.completedAt;
    if (this.account.username === h) return;
    if (done && this.usernameChangedAt && Date.now() - this.usernameChangedAt < 30 * 86_400_000) throw fail('invalid', 'You can change your username once every 30 days.');
    if (this.account.username) FakeAccountApi.handles.delete(this.account.username);
    FakeAccountApi.handles.set(h, this.account.userId); if (this.account.username && done) this.usernameChangedAt = Date.now();
    this.account.username = h;
  }
  async searchPlaces(q: string) { await this.gate('searchPlaces'); return fakeSearchPlaces(q); }
  async nearestPlaces(lat: number, lng: number) { await this.gate('nearestPlaces'); if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('invalid', 'That location isn’t valid.'); return fakeNearestPlaces(lat, lng); }
  async savePlace(placeId: number) {
    await this.gate('savePlace');
    const pl = fakePlaceById(placeId); if (!pl) throw fail('invalid', 'Choose a place from the list.');
    const { id, name, region, countryCode, country, label } = pl;
    this.account.place = { id, name, region, countryCode, country, label } satisfies PlaceHit;
    this.account.areaLabel = (region && region !== name ? `${name}, ${region}` : name).slice(0, 80);
  }
  async clearPlace() { await this.gate('clearPlace'); this.account.place = null; }
  async saveFilters(f: DatingFilters) {
    await this.gate('saveFilters');
    if ((f.heightMin !== null && (f.heightMin < 120 || f.heightMin > 230)) || (f.heightMax !== null && (f.heightMax < 120 || f.heightMax > 230)) || (f.heightMin !== null && f.heightMax !== null && f.heightMin > f.heightMax)) throw fail('invalid', 'Check the height range.');
    Object.assign(this.account, { filterIntentions: [...f.intentions], filterInterests: [...f.interests], filterHeightMin: f.heightMin, filterHeightMax: f.heightMax, filterDrinking: [...f.drinking], filterSmoking: [...f.smoking], filterKids: [...f.kids] });
  }
  async saveDetails(d: ProfileDetails, visibility: VisibilityMap, opts: { religionOptIn: boolean }) {
    await this.gate('saveDetails');
    if (Object.keys(validateDetails(d)).length) throw fail('invalid', 'Check your details.');
    if (d.religion && !opts.religionOptIn) throw fail('invalid', 'Religion is only saved when you opt in.');
    this.account.details = { ...d, instagramHandle: d.instagramHandle ? d.instagramHandle.trim().replace(/^@/, '').toLowerCase() : null, jobTitle: d.jobTitle?.trim() || null, companyOrSchool: d.companyOrSchool?.trim() || null, languages: [...d.languages].slice(0, DETAIL_LIMITS.languagesMax), pets: [...d.pets] };
    const vis = { ...this.account.visibility, ...visibility }; if (!d.religion) delete vis.religion; this.account.visibility = vis;
  }
  async saveAvatar(photoId: string | null, crop: AvatarCrop | null, blurhash?: string | null) {
    await this.gate('saveAvatar');
    if (photoId && !this.account.photos.some((p) => p.id === photoId)) throw fail('invalid', 'Choose one of your own photos.');
    this.account.avatarPhotoId = photoId; this.account.avatarCrop = photoId ? crop : null; this.account.avatarBlurhash = photoId ? (blurhash ?? null) : null;
  }
  async setAccountPrivate(isPrivate: boolean) { await this.gate('setAccountPrivate'); this.account.socialVisibility = isPrivate ? 'followers' : 'public'; }
  async saveSocialSettings(x: { allowComments: 'everyone' | 'followers' | 'nobody'; showFollowerCounts: boolean; searchable: boolean; showAvatarToEveryone: boolean }) {
    await this.gate('saveSocialSettings');
    this.account.allowComments = x.allowComments; this.account.showFollowerCounts = x.showFollowerCounts; this.account.searchable = x.searchable; this.account.showAvatarToEveryone = x.showAvatarToEveryone;
  }
  async recordConsent(termsVersion: string, marketing?: boolean) {
    await this.gate('recordConsent'); if (!termsVersion.trim()) throw fail('invalid', 'Accept the terms to continue.');
    this.account.consent = { termsVersion, marketing: marketing ?? this.account.consent?.marketing ?? false };
  }
  async setMarketingConsent(on: boolean) { await this.gate('setMarketingConsent'); if (!this.account.consent) throw fail('invalid', 'Accept the terms first.'); this.account.consent.marketing = on; }
  async completeOnboarding() {
    await this.gate('completeOnboarding');
    const missing = missingRequired(this.account, this.today);
    if (missing.length) throw fail('onboarding_incomplete', 'Finish the required steps first.', missing.map((m) => m.field));
    this.account.onboarding = { currentStep: 'review', completedAt: new Date().toISOString() };
    return this.account.onboarding.completedAt!;
  }
}
