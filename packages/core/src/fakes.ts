import { dobError, ageOn, todayLocalIso } from './age';
import { missingRequired, validateAbout, validateBasics, validatePreferences, validatePrivacy, interestLabel, stepIndex, type Account, type AccountPhoto, type Step } from './account';
import { validatePhotoInput, validateStoredPhoto, PHOTO_RULES } from './photos';
import { AccountFailure, AuthFailure, type AccountApi, type AccountErrorCode, type AuthApi, type AuthErrorCode, type AuthUser } from './ports';
import { validateEmail, validatePassword } from './auth';
import { photoDataUri } from './art';
import { roundCoord, type DatingFilters, type Place } from './dating';

/* In-memory implementations used by MOCKED tests only. They are not evidence about Supabase behaviour. */

export class FakeAuthApi implements AuthApi {
  users = new Map<string, { id: string; password: string; confirmed: boolean }>();
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
  async signUp(email: string, password: string) {
    await this.maybeFail('signUp');
    if (validateEmail(email) || validatePassword(password, email)) throw new AuthFailure('weak_password', 'weak');
    const key = email.toLowerCase();
    if (!this.users.has(key)) this.users.set(key, { id: crypto.randomUUID(), password, confirmed: false });
    return { needsConfirmation: true }; // identical for new and existing addresses
  }
  async signIn(email: string, password: string) {
    await this.maybeFail('signIn');
    const u = this.users.get(email.toLowerCase());
    if (!u || u.password !== password) throw new AuthFailure('invalid_credentials', 'Email or password is incorrect.');
    if (!u.confirmed) throw new AuthFailure('email_not_confirmed', 'Confirm your email first.');
    this.current = { id: u.id, email: email.toLowerCase(), emailConfirmed: true };
    this.emit('SIGNED_IN');
    return this.current;
  }
  async signOut() { await this.maybeFail('signOut'); this.current = null; this.emit('SIGNED_OUT'); }
  async resendConfirmation() { await this.maybeFail('resend'); }
  async requestPasswordReset() { await this.maybeFail('reset'); }
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
      socialVisibility: 'public', datingDiscoverable: true, photos: [], onboarding: { currentStep: 'basics', completedAt: null },
      gender: null, showGender: true, showDistance: true, place: null, filterIntentions: [], filterInterests: [],
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
    if (Object.keys(validateBasics(i, this.today, locked)).length) throw fail('invalid', 'Invalid basics.');
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
    if (Object.keys(validatePrivacy(i)).length) throw fail('invalid', 'Invalid privacy.');
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
  async saveDatingProfile(i: Parameters<AccountApi['saveDatingProfile']>[0]) {
    await this.gate('saveDatingProfile');
    if (!['woman', 'man', 'non-binary'].includes(i.gender)) throw fail('invalid', 'Choose a gender.');
    Object.assign(this.account, { gender: i.gender, showGender: i.showGender, showDistance: i.showDistance });
  }
  async savePlace(p: Place) {
    await this.gate('savePlace');
    if (!p.label.trim() || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) throw fail('invalid', 'Choose a place.');
    this.account.place = { label: p.label.trim(), lat: roundCoord(p.lat), lng: roundCoord(p.lng) }; this.account.areaLabel = p.label.trim();
  }
  async clearPlace() { await this.gate('clearPlace'); this.account.place = null; }
  async saveFilters(f: DatingFilters) { await this.gate('saveFilters'); this.account.filterIntentions = [...f.intentions]; this.account.filterInterests = [...f.interests]; }
  async completeOnboarding() {
    await this.gate('completeOnboarding');
    const missing = missingRequired(this.account, this.today);
    if (missing.length) throw fail('onboarding_incomplete', 'Finish the required steps first.', missing.map((m) => m.field));
    this.account.onboarding = { currentStep: 'review', completedAt: new Date().toISOString() };
    return this.account.onboarding.completedAt!;
  }
}
