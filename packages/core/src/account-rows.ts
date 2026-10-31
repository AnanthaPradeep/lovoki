import { ageOn, todayLocalIso } from './age';
import { interestLabel, isStep, type Account, type AccountPhoto, type InterestedIn, type SocialVisibility } from './account';
import { ALL_INTENTIONS } from './seed';
import type { Intention } from './types';
import type { AvatarCrop, Gender, PlaceHit } from './dating';
import { emptyDetails, type ProfileDetails, type VisibilityMap } from './profile';

/** Row shapes returned by the database (snake_case). Kept separate from the domain model on purpose. */
export interface AccountRows {
  userId: string; email: string | null;
  private: { date_of_birth: string | null };
  profile: { display_name: string | null; pronouns: string; bio: string; intention: string | null; area_label: string; social_visibility: string; dating_discoverable: boolean; gender?: string | null; show_gender?: boolean; show_distance?: boolean;
    username?: string | null; gender_custom?: string | null; avatar_photo_id?: string | null; avatar_crop?: AvatarCrop | null; allow_comments?: string; show_follower_counts?: boolean };
  prefs: { interested_in: string[]; age_min: number; age_max: number; max_distance_km: number | null; filter_intentions?: string[]; filter_interests?: string[];
    filter_height_min?: number | null; filter_height_max?: number | null; filter_drinking?: string[]; filter_smoking?: string[]; filter_kids?: string[] };
  /** From my_place(): a label and ids, never coordinates. */
  place?: { place_id: number | null; name: string | null; region: string | null; country_code: string | null; country: string | null; label: string } | null;
  details?: { instagram_handle: string | null; height_cm: number | null; job_title: string | null; company_or_school: string | null; education_level: string | null; languages: string[]; drinking: string | null;
    smoking: string | null; exercise: string | null; diet: string | null; pets: string[]; has_kids: string | null; wants_kids: string | null; relationship_structure: string | null; religion: string | null; visibility: VisibilityMap } | null;
  consent?: { terms_version: string; marketing: boolean } | null;
  onboarding: { current_step: string; completed_at: string | null };
  interests: { slug: string }[];
  prompts: { position: number; question: string; answer: string }[];
  photos: { id: string; storage_path: string; position: number; content_type: string; size_bytes: number }[];
}

function detailsFromRow(d: AccountRows['details']): ProfileDetails {
  if (!d) return emptyDetails();
  return { instagramHandle: d.instagram_handle, heightCm: d.height_cm, jobTitle: d.job_title, companyOrSchool: d.company_or_school, educationLevel: d.education_level, languages: d.languages ?? [],
    drinking: d.drinking, smoking: d.smoking, exercise: d.exercise, diet: d.diet, pets: d.pets ?? [], hasKids: d.has_kids, wantsKids: d.wants_kids, relationshipStructure: d.relationship_structure, religion: d.religion };
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
    gender: (['woman', 'man', 'non-binary', 'self-describe'] as string[]).includes(r.profile.gender ?? '') ? (r.profile.gender as Gender) : null,
    showGender: r.profile.show_gender ?? true, showDistance: r.profile.show_distance ?? true,
    username: r.profile.username ?? null, genderCustom: r.profile.gender_custom ?? null,
    place: r.place ? ({ id: r.place.place_id, name: r.place.name ?? r.place.label, region: r.place.region ?? '', countryCode: r.place.country_code ?? '', country: r.place.country ?? '', label: r.place.label } satisfies PlaceHit) : null,
    avatarPhotoId: r.profile.avatar_photo_id ?? null, avatarCrop: r.profile.avatar_crop ?? null,
    details: detailsFromRow(r.details), visibility: r.details?.visibility ?? {},
    allowComments: r.profile.allow_comments === 'followers' || r.profile.allow_comments === 'nobody' ? r.profile.allow_comments : 'everyone', showFollowerCounts: r.profile.show_follower_counts ?? true,
    consent: r.consent ? { termsVersion: r.consent.terms_version, marketing: r.consent.marketing } : null,
    filterHeightMin: r.prefs.filter_height_min ?? null, filterHeightMax: r.prefs.filter_height_max ?? null,
    filterDrinking: r.prefs.filter_drinking ?? [], filterSmoking: r.prefs.filter_smoking ?? [], filterKids: r.prefs.filter_kids ?? [],
    filterIntentions: r.prefs.filter_intentions ?? [], filterInterests: (r.prefs.filter_interests ?? []).map((x) => interestLabel(x)).filter((x): x is string => !!x).sort(),
    onboarding: { currentStep: isStep(r.onboarding.current_step) ? r.onboarding.current_step : 'basics', completedAt: r.onboarding.completed_at },
  };
}
