import { ageOn, todayLocalIso } from './age';
import { interestLabel, isStep, type Account, type AccountPhoto, type InterestedIn, type SocialVisibility } from './account';
import { ALL_INTENTIONS } from './seed';
import type { Intention } from './types';
import type { Gender } from './dating';

/** Row shapes returned by the database (snake_case). Kept separate from the domain model on purpose. */
export interface AccountRows {
  userId: string; email: string | null;
  private: { date_of_birth: string | null };
  profile: { display_name: string | null; pronouns: string; bio: string; intention: string | null; area_label: string; social_visibility: string; dating_discoverable: boolean; gender?: string | null; show_gender?: boolean; show_distance?: boolean };
  prefs: { interested_in: string[]; age_min: number; age_max: number; max_distance_km: number | null; filter_intentions?: string[]; filter_interests?: string[] };
  place?: { lat: number; lng: number } | null;
  onboarding: { current_step: string; completed_at: string | null };
  interests: { slug: string }[];
  prompts: { position: number; question: string; answer: string }[];
  photos: { id: string; storage_path: string; position: number; content_type: string; size_bytes: number }[];
}

const INTERESTED: InterestedIn[] = ['women', 'men', 'non-binary'];

export function accountFromRows(r: AccountRows, today = todayLocalIso()): Account {
  const dob = r.private.date_of_birth;
  const intention = ALL_INTENTIONS.includes(r.profile.intention as Intention) ? (r.profile.intention as Intention) : null;
  const photos: AccountPhoto[] = [...r.photos].sort((a, b) => a.position - b.position)
    .map((p) => ({ id: p.id, path: p.storage_path, position: p.position, contentType: p.content_type, sizeBytes: p.size_bytes }));
  return {
    userId: r.userId, email: r.email,
    displayName: r.profile.display_name ?? '', pronouns: r.profile.pronouns, dateOfBirth: dob, age: dob ? ageOn(dob, today) : null,
    bio: r.profile.bio,
    interests: r.interests.map((i) => interestLabel(i.slug)).filter((x): x is string => !!x).sort(),
    prompts: [...r.prompts].sort((a, b) => a.position - b.position).map((p) => ({ question: p.question, answer: p.answer })),
    intention, interestedIn: r.prefs.interested_in.filter((x): x is InterestedIn => (INTERESTED as string[]).includes(x)),
    ageMin: r.prefs.age_min, ageMax: r.prefs.age_max, maxDistanceKm: r.prefs.max_distance_km,
    areaLabel: r.profile.area_label,
    socialVisibility: (r.profile.social_visibility === 'followers' ? 'followers' : 'public') as SocialVisibility,
    datingDiscoverable: r.profile.dating_discoverable,
    photos,
    gender: (['woman', 'man', 'non-binary'] as string[]).includes(r.profile.gender ?? '') ? (r.profile.gender as Gender) : null,
    showGender: r.profile.show_gender ?? true, showDistance: r.profile.show_distance ?? true,
    place: r.place ? { label: r.profile.area_label, lat: Number(r.place.lat), lng: Number(r.place.lng) } : null,
    filterIntentions: r.prefs.filter_intentions ?? [], filterInterests: (r.prefs.filter_interests ?? []).map((x) => interestLabel(x)).filter((x): x is string => !!x).sort(),
    onboarding: { currentStep: isStep(r.onboarding.current_step) ? r.onboarding.current_step : 'basics', completedAt: r.onboarding.completed_at },
  };
}
