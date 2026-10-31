import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AccountFailure, PHOTO_BUCKET, PHOTO_PATH_RE, accountFromRows, interestSlug, photoPath, sniffImageType, validateStoredPhoto,
  type AboutInput, type Account, type AccountApi, type AccountPhoto, type AccountRows, type BasicsInput, type PreferencesInput,
  type PrivacyInput, type Step, type UserScope, type DatingProfileInput, type DatingFilters, type Place,
} from '@lovoki/core';

interface DbError { message?: string; code?: string; status?: number; statusCode?: string | number }

/** Maps Postgres/PostgREST/Storage errors to safe messages. Never shows raw database text. */
export function toAccountFailure(e: unknown): AccountFailure {
  if (e instanceof AccountFailure) return e;
  const r: DbError = typeof e === 'object' && e ? (e as DbError) : {};
  const m = r.message ?? '';
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)) return new AccountFailure('network', 'Can’t reach LOVOKI. Check your connection and try again.');
  if (m.includes('LOVOKI_UNDER_18')) return new AccountFailure('under_18', 'LOVOKI is for adults 18 and over.');
  if (m.includes('LOVOKI_DOB_LOCKED')) return new AccountFailure('dob_locked', 'Date of birth can’t be changed after setup is complete.');
  if (m.includes('LOVOKI_DOB_IMPLAUSIBLE')) return new AccountFailure('invalid', 'Check the year of birth.');
  const inc = /LOVOKI_ONBOARDING_INCOMPLETE:([\w,]+)/.exec(m);
  if (inc) return new AccountFailure('onboarding_incomplete', 'Finish the required steps first.', inc[1]!.split(','));
  if (m.includes('LOVOKI_PHOTO_LIMIT')) return new AccountFailure('photo_limit', 'You can add up to 6 photos.');
  if (m.includes('LOVOKI_PHOTO_MISSING')) return new AccountFailure('invalid', 'The upload didn’t finish. Try again.');
  if (m.includes('LOVOKI_LAST_PHOTO')) return new AccountFailure('invalid', 'Keep at least one photo on your profile.');
  if (m.includes('LOVOKI_NOT_FOUND')) return new AccountFailure('invalid', 'That photo no longer exists. Reload and try again.');
  if (m.includes('LOVOKI_UNAUTHENTICATED') || r.status === 401 || r.code === 'PGRST301' || /jwt/i.test(m)) return new AccountFailure('unauthorized', 'Your session ended. Log in again.');
  if (m.includes('LOVOKI_INVALID') || /^2[23]/.test(r.code ?? '')) return new AccountFailure('invalid', 'Some details aren’t valid. Check them and try again.');
  if (r.statusCode === '413' || r.statusCode === 413) return new AccountFailure('invalid', 'That image is too large.');
  return new AccountFailure('unknown', 'Couldn’t save that. Try again.');
}

const ORPHAN_AGE_MS = 10 * 60 * 1000;

export class SupabaseAccountApi implements AccountApi {
  private urls = new Map<string, { url: string; exp: number }>();
  constructor(private sb: SupabaseClient, private userId: string, private email: string | null, scope?: UserScope) {
    scope?.register('signed-photo-urls', () => this.urls.clear());
  }

  private async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw toAccountFailure(error);
    return data as T;
  }

  async load(): Promise<Account> {
    await this.rpc('ensure_account'); // repairs partially created accounts; idempotent
    const id = this.userId, sb = this.sb;
    const [priv, prof, prefs, onb, ints, prompts, photos, place] = await Promise.all([
      sb.from('profiles_private').select('date_of_birth').eq('user_id', id).maybeSingle(),
      sb.from('profiles').select('display_name,pronouns,bio,intention,area_label,social_visibility,dating_discoverable,gender,show_gender,show_distance').eq('user_id', id).maybeSingle(),
      sb.from('dating_preferences').select('interested_in,age_min,age_max,max_distance_km,filter_intentions,filter_interests').eq('user_id', id).maybeSingle(),
      sb.from('onboarding_state').select('current_step,completed_at').eq('user_id', id).maybeSingle(),
      sb.from('profile_interests').select('slug').eq('user_id', id),
      sb.from('profile_prompts').select('position,question,answer').eq('user_id', id).order('position'),
      sb.from('profile_photos').select('id,storage_path,position,content_type,size_bytes').eq('user_id', id).order('position'),
      sb.from('profile_places').select('lat,lng').eq('user_id', id).maybeSingle(),
    ]);
    for (const r of [priv, prof, prefs, onb, ints, prompts, photos, place]) if (r.error) throw toAccountFailure(r.error);
    if (!priv.data || !prof.data || !prefs.data || !onb.data) throw new AccountFailure('unknown', 'Your profile couldn’t be loaded. Try again.');
    const rows = { userId: id, email: this.email, private: priv.data, profile: prof.data, prefs: prefs.data, onboarding: onb.data,
      interests: ints.data ?? [], prompts: prompts.data ?? [], photos: photos.data ?? [], place: place.data ?? null } as unknown as AccountRows;
    const account = accountFromRows(rows);
    void this.sweepOrphans(account.photos);
    return account;
  }

  async saveBasics(i: BasicsInput) { await this.rpc('save_basics', { p_display_name: i.displayName, p_date_of_birth: i.dateOfBirth, p_pronouns: i.pronouns }); }
  async saveAbout(i: AboutInput) {
    await this.rpc('save_about', { p_bio: i.bio, p_interests: i.interests.map(interestSlug), p_prompts: i.prompts.map((p) => ({ question: p.question, answer: p.answer })) });
  }
  async savePreferences(i: PreferencesInput) {
    await this.rpc('save_preferences', { p_intention: i.intention, p_interested_in: i.interestedIn, p_age_min: i.ageMin, p_age_max: i.ageMax, p_max_distance: i.maxDistanceKm });
  }
  async savePrivacy(i: PrivacyInput) {
    await this.rpc('save_privacy', { p_area_label: i.areaLabel, p_social_visibility: i.socialVisibility, p_dating_discoverable: i.datingDiscoverable });
  }
  async setStep(step: Step) { await this.rpc('set_onboarding_step', { p_step: step }); }

  async uploadPhoto(image: Blob): Promise<AccountPhoto> {
    const bad = validateStoredPhoto(image);
    if (bad) throw new AccountFailure('invalid', bad);
    const sniffed = sniffImageType(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
    if (!sniffed || sniffed !== image.type) throw new AccountFailure('invalid', 'That file isn’t a supported image.');
    const path = photoPath(this.userId, crypto.randomUUID(), sniffed); // the client never chooses a name
    const up = await this.sb.storage.from(PHOTO_BUCKET).upload(path, image, { contentType: sniffed, upsert: false, cacheControl: '3600' });
    if (up.error) throw toAccountFailure(up.error);
    try {
      const photoId = await this.rpc<string>('register_photo', { p_path: path });
      const { data, error } = await this.sb.from('profile_photos').select('id,storage_path,position,content_type,size_bytes').eq('id', photoId).single();
      if (error || !data) throw toAccountFailure(error);
      return { id: data.id, path: data.storage_path, position: data.position, contentType: data.content_type, sizeBytes: data.size_bytes };
    } catch (e) {
      await this.sb.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined); // do not leave an unregistered object behind
      throw e;
    }
  }

  async reorderPhotos(ids: string[]) { await this.rpc('reorder_photos', { p_ids: ids }); }

  async deletePhoto(id: string) {
    const path = await this.rpc<string>('delete_photo', { p_id: id });
    this.urls.delete(path);
    const { error } = await this.sb.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) console.warn('LOVOKI: photo row deleted but the stored file could not be removed; it will be swept.');
  }

  async photoUrl(path: string) {
    const hit = this.urls.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await this.sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
    if (error || !data) throw toAccountFailure(error);
    this.urls.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  async saveDatingProfile(i: DatingProfileInput) { await this.rpc('save_dating_profile', { p_gender: i.gender, p_show_gender: i.showGender, p_show_distance: i.showDistance }); }
  async savePlace(p: Place) { await this.rpc('save_place', { p_label: p.label, p_lat: p.lat, p_lng: p.lng }); }
  async clearPlace() { await this.rpc('clear_place'); }
  async saveFilters(f: DatingFilters) { await this.rpc('save_dating_filters', { p_intentions: f.intentions, p_interests: f.interests.map(interestSlug) }); }

  async completeOnboarding() { return this.rpc<string>('complete_onboarding'); }

  /** Best effort: remove this user's stored files that no photo row refers to (failed uploads, failed removals). */
  private async sweepOrphans(registered: AccountPhoto[]) {
    try {
      const keep = new Set(registered.map((p) => p.path));
      const { data } = await this.sb.storage.from(PHOTO_BUCKET).list(this.userId, { limit: 100 });
      const stale = (data ?? [])
        .map((o) => ({ path: `${this.userId}/${o.name}`, at: o.created_at ? Date.parse(o.created_at) : Date.now() }))
        .filter((o) => PHOTO_PATH_RE.test(o.path) && !keep.has(o.path) && Date.now() - o.at > ORPHAN_AGE_MS)
        .map((o) => o.path);
      if (stale.length) await this.sb.storage.from(PHOTO_BUCKET).remove(stale);
    } catch { /* never block the app on cleanup */ }
  }
}
