import type { AppState, Photo, Post, Profile, Conversation, Intention } from './types';
import { DEFAULT_FILTERS } from './types';

/** All people below are fictional adults. Photos are generated, non-identifiable art. */

const gp = (id: string, seed: number, alt: string): Photo => ({ id, kind: 'generated', seed, alt });

type P = Omit<Profile, 'photos' | 'verification' | 'followers' | 'following'> &
  Partial<Pick<Profile, 'verification' | 'followers' | 'following'>> & { seeds: number[] };

const people: P[] = [
  { id: 'maya', name: 'Maya', age: 29, area: 'Fort Kochi', distanceKm: 4, work: 'Ceramicist', intention: 'long-term', demoLikesYou: true, verification: 'demo-photo-check',
    bio: 'I make bowls that are slightly too big for soup. Mornings by the water, evenings with a library book I will return late.',
    interests: ['Ceramics', 'Swimming', 'Cooking', 'Bookshops'],
    prompts: [{ question: 'A perfect Sunday', answer: 'Kiln opening at nine, beach at noon, nobody asking me to be productive after four.' }, { question: 'I geek out on', answer: 'Glaze chemistry. Ask me about ash glazes at your own risk.' }], seeds: [3, 1003, 9] },
  { id: 'arjun', name: 'Arjun', age: 32, area: 'Indiranagar, Bengaluru', distanceKm: 18, work: 'Product designer', intention: 'long-term-open',
    bio: 'Designer by day, terrible amateur drummer by night. Looking for someone who laughs at their own jokes first.',
    interests: ['Drumming', 'Design', 'Running', 'Street food'],
    prompts: [{ question: 'The way to win me over', answer: 'Recommend a song I end up playing on repeat for a whole week.' }], seeds: [14, 1014] },
  { id: 'lena', name: 'Lena', age: 27, area: 'Kreuzberg, Berlin', distanceKm: 6, work: 'Translator', intention: 'figuring-out',
    bio: 'Translating German poetry into English and back again until it means something new.',
    interests: ['Poetry', 'Cycling', 'Film', 'Languages'],
    prompts: [{ question: 'My most irrational fear', answer: 'That the last page of a book will be missing.' }], seeds: [20, 1020] },
  { id: 'kofi', name: 'Kofi', age: 35, area: 'East Legon, Accra', distanceKm: 9, work: 'Architect', intention: 'long-term', demoLikesYou: true,
    bio: 'I draw buildings and then argue with engineers about them. Cooking jollof for anyone who will taste-test.',
    interests: ['Architecture', 'Cooking', 'Football', 'Jazz'],
    prompts: [{ question: 'Two truths and a lie', answer: 'I built a treehouse at 12. I have never missed a flight. I can whistle in two keys.' }], seeds: [25, 1025, 31] },
  { id: 'sofia', name: 'Sofía', age: 30, area: 'Palermo, Buenos Aires', distanceKm: 12, work: 'Pastry chef', intention: 'long-term-open',
    bio: 'Up at 4 for croissants. Asleep by 10. Somewhere in between, very good company.',
    interests: ['Baking', 'Tango', 'Markets', 'Cooking'],
    prompts: [{ question: 'Green flags I look for', answer: 'You tip well and you are kind to waiters on their worst day.' }], seeds: [36, 1036] },
  { id: 'hiro', name: 'Hiro', age: 41, area: 'Shimokitazawa, Tokyo', distanceKm: 22, work: 'Record shop owner', intention: 'friends-first',
    bio: 'Running a tiny record shop with a very large cat. Vinyl, coffee, and slow conversation.',
    interests: ['Vinyl', 'Coffee', 'Photography', 'Cats'],
    prompts: [{ question: 'A shower thought I recently had', answer: 'Every record is just a very long, very thin spiral.' }], seeds: [42, 1042] },
  { id: 'amara', name: 'Amara', age: 26, area: 'Yaba, Lagos', distanceKm: 7, work: 'Software engineer', intention: 'short-term-open',
    bio: 'Writes code, writes short fiction, writes lists about both.',
    interests: ['Writing', 'Coding', 'Afrobeats', 'Running'],
    prompts: [{ question: 'I am weirdly attracted to', answer: 'People who reread the same book every year.' }], seeds: [48, 1048] },
  { id: 'theo', name: 'Theo', age: 33, area: 'Leith, Edinburgh', distanceKm: 3, work: 'Paramedic', intention: 'long-term',
    bio: 'Shift work, hill walks, and a shameless love of terrible puns.',
    interests: ['Hiking', 'Climbing', 'Board games', 'Cooking'],
    prompts: [{ question: 'My simple pleasures', answer: 'A flask of tea on a summit when the cloud finally clears.' }], seeds: [54, 1054] },
  { id: 'priya', name: 'Priya', age: 31, area: 'Kaloor, Kochi', distanceKm: 6, work: 'Marine biologist', intention: 'long-term', demoLikesYou: true,
    bio: 'I count fish for science. Off the clock I am learning the veena very slowly.',
    interests: ['Diving', 'Music', 'Bookshops', 'Swimming'],
    prompts: [{ question: 'Together, we could', answer: 'Find the best appam in the city and argue about the runner-up.' }], seeds: [60, 1060] },
  { id: 'mateo', name: 'Mateo Alejandro de la Fuente-Villanueva', age: 28, area: 'Gràcia, Barcelona', distanceKm: 11, work: 'Muralist', intention: 'figuring-out',
    bio: 'Yes, the name is long. My murals are longer. I paint walls that neighbours complain about, then grow to love.',
    interests: ['Painting', 'Cycling', 'Film', 'Markets'],
    prompts: [{ question: 'This year, I really want to', answer: 'Paint a wall big enough that you can see it from the train before it enters the tunnel under the old station.' }], seeds: [66, 1066] },
  { id: 'nadia', name: 'Nadia', age: 37, area: 'Plateau, Montréal', distanceKm: 5, work: 'Cellist', intention: 'long-term-open',
    bio: 'Orchestra cellist. Cross-country skier. I will make you a very serious playlist.',
    interests: ['Music', 'Skiing', 'Cooking', 'Film'],
    prompts: [{ question: 'Dating me is like', answer: 'Rehearsal: a little messy, then suddenly it sounds right.' }], seeds: [72, 1072] },
  { id: 'jonas', name: 'Jonas', age: 24, area: 'Södermalm, Stockholm', distanceKm: 8, work: 'Barista and student', intention: 'friends-first',
    bio: 'Studying urban planning, pulling espresso, collecting bus maps.',
    interests: ['Coffee', 'Transit', 'Photography', 'Running'],
    prompts: [{ question: 'Unpopular opinion', answer: 'The bus is more romantic than the train.' }], seeds: [78, 1078] },
  { id: 'zara', name: 'Zara', age: 34, area: 'Bandra, Mumbai', distanceKm: 45, work: 'Documentary producer', intention: 'long-term',
    bio: 'Making films about people who fix things. Probably late, always worth it.',
    interests: ['Film', 'Photography', 'Street food', 'Languages'],
    prompts: [{ question: 'My love language', answer: 'Remembering the small thing you said three weeks ago.' }], seeds: [84, 1084] },
  { id: 'eli', name: 'Eli', age: 30, area: 'Fitzroy, Melbourne', distanceKm: 14, work: 'Landscape gardener', intention: 'short-term-open',
    bio: 'Plants things for a living. Keeps a sourdough starter called Gerald.',
    interests: ['Gardening', 'Baking', 'Hiking', 'Vinyl'],
    prompts: [{ question: 'A non-negotiable', answer: 'Dogs are allowed on the sofa.' }], seeds: [90, 1090] },
];

export function seedProfiles(): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  people.forEach((p, i) => {
    const { seeds, ...rest } = p;
    const photos: Photo[] = seeds.map((s, j) => gp(`${p.id}-ph${j}`, s, `${p.name}, photo ${j + 1}`));
    // Deliberate broken image to exercise the fallback state.
    if (p.id === 'hiro') photos.unshift({ id: 'hiro-broken', kind: 'uri', uri: 'https://invalid.lovoki.example/missing.jpg', alt: 'Hiro, photo 1' });
    out[p.id] = { verification: 'none', followers: 120 + i * 37, following: 80 + i * 11, ...rest, photos };
  });
  return out;
}

export function seedMe(): Profile {
  return {
    id: 'me', name: 'Pradi', age: 30, area: 'Technopark, Thiruvananthapuram', distanceKm: 0, work: 'Frontend developer',
    bio: 'Building interfaces by day, writing songs by night.',
    intention: 'long-term-open', interests: ['Music', 'Coding', 'Cooking'],
    prompts: [{ question: 'I geek out on', answer: 'Tiny interaction details nobody notices until they are missing.' }],
    photos: [gp('me-ph0', 7, 'Your photo 1')], verification: 'none', followers: 214, following: 3,
  };
}

const H = 3_600_000;

export function seedState(now = Date.now()): AppState {
  const profiles = seedProfiles();
  const captions: [string, number, string, 'public' | 'followers'][] = [
    ['maya', 1001, 'First firing of the new kiln. Three cracked, nine perfect. I will take it.', 'public'],
    ['kofi', 1002, 'Site visit, golden hour. The light does half the design work.', 'public'],
    ['hiro', 1005, 'New arrivals: forty records from a collector who kept every sleeve pristine.', 'public'],
    ['sofia', 1006, 'Laminated dough, day three. Patience is an ingredient.', 'followers'],
    ['theo', 1008, 'Made it up before the cloud did.', 'public'],
    ['lena', 1009, 'Found a 1962 edition in a flea market for two euros. Inside, a pressed flower and a train ticket to Prague.', 'public'],
    ['mateo', 1011, 'Day 14 on the wall at Carrer de Verdi. The neighbours have started bringing coffee, which I take as approval, and also as a reason to keep going past dark even though the scaffolding rental ends on Friday and I have not finished the sky.', 'public'],
    ['nadia', 1012, 'Rehearsal room view.', 'followers'],
    ['priya', 1013, 'Reef survey done. Counted 212 parrotfish. They counted me back.', 'public'],
    ['amara', 1015, 'Short story draft #4 finished on the ferry.', 'public'],
    ['eli', 1016, 'Gerald the starter, now three years old.', 'public'],
    ['jonas', 1017, 'Every bus map I own, in one drawer.', 'public'],
    ['zara', 1018, 'Wrap day. Thank you to the bicycle repair crew of Dharavi.', 'public'],
    ['arjun', 1019, 'Practice pad, day 100.', 'followers'],
    ['maya', 1021, 'Test tiles for a commission. The blue on the left wins.', 'public'],
    ['kofi', 1022, 'Sunday jollof, quality control in progress.', 'public'],
    ['priya', 1023, 'Lab notebook, field edition.', 'followers'],
    ['me', 1024, 'Late night, new melody, old guitar.', 'public'],
  ];
  const posts: Post[] = captions.map(([authorId, seed, caption, audience], i) => ({
    id: `post-${i + 1}`, authorId, caption, audience,
    photo: i === 9 ? null : gp(`post-${i + 1}-ph`, seed, `Photo shared by ${authorId === 'me' ? 'you' : profiles[authorId]!.name}`),
    createdAt: now - (i + 1) * 2.5 * H,
    likeCount: 8 + ((i * 17) % 90), likedByMe: i === 2, savedByMe: i === 5,
    comments: i % 3 === 0 ? [{ id: `c-${i}-1`, authorId: 'theo', text: 'This is lovely.', createdAt: now - (i + 1) * 2 * H }] : [],
  }));

  const conv = (profileId: string, unread: number, lines: [boolean, string, number][]): Conversation => ({
    profileId, unread,
    messages: lines.map(([fromMe, text, hoursAgo], i) => ({
      id: `${profileId}-m${i}`, fromMe, text, createdAt: now - hoursAgo * H,
      delivery: fromMe ? (i === lines.length - 1 ? 'delivered' : 'read') : 'read',
    })),
  });

  return {
    version: 1,
    me: seedMe(),
    profiles,
    posts,
    liked: ['sofia', 'theo', 'nadia'],
    passed: [],
    matches: [
      { profileId: 'sofia', matchedAt: now - 30 * H, demo: true },
      { profileId: 'theo', matchedAt: now - 52 * H, demo: true },
      { profileId: 'nadia', matchedAt: now - 3 * H, demo: true },
    ],
    following: ['maya', 'kofi', 'hiro'],
    followers: ['lena', 'jonas', 'eli', 'maya'],
    conversations: {
      sofia: conv('sofia', 2, [[true, 'Your bio made me hungry. What is the one pastry you would defend to the end?', 28], [false, 'Medialunas. No contest.', 27], [false, 'Okay, but which one would you defend?', 1.2]]),
      theo: conv('theo', 0, [[false, 'A paramedic who loves puns. You have been warned.', 50], [true, 'I can handle it. Probably.', 49], [false, 'Why did the hill walker bring a ladder? To reach new heights.', 48], [true, 'I am already regretting this match.', 47]]),
      nadia: { profileId: 'nadia', unread: 0, messages: [] },
    },
    blocked: [],
    reports: [],
    filters: { ...DEFAULT_FILTERS },
    privacy: { datingDiscoverable: true, socialVisibility: 'public', showDistance: true },
    theme: 'system',
  };
}

/** Beyond the demo people's own interests, the expanded catalog (mirrors the interests table in the database). */
const EXTRA_INTERESTS = ['Anime', 'Astronomy', 'Badminton', 'Basketball', 'Birdwatching', 'Bollywood', 'Camping', 'Carnatic music', 'Chess', 'Cricket', 'Dancing', 'Fashion', 'Fishing', 'Fitness', 'Gaming',
  'History', 'Karaoke', 'Kabaddi', 'Knitting', 'Martial arts', 'Meditation', 'Motorcycles', 'Museums', 'Podcasts', 'Reading', 'Road trips', 'Sailing', 'Skateboarding', 'Stand-up comedy',
  'Street photography', 'Tea', 'Tennis', 'Theatre', 'Thrifting', 'Travel', 'Trekking', 'Volleyball', 'Volunteering', 'Woodworking', 'Yoga'];
export const ALL_INTERESTS = Array.from(new Set([...people.flatMap((p) => p.interests), ...EXTRA_INTERESTS])).sort();
export const ALL_INTENTIONS = Object.keys({
  'long-term': 1, 'long-term-open': 1, 'short-term-open': 1, 'figuring-out': 1, 'friends-first': 1,
}) as Intention[];
