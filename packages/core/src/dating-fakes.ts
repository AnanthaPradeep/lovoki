import {
  DATING_LIMITS, DatingFailure, bucketOf, effectiveMaxKm, haversineKm, safeDiscoverCursor, wantsGender,
  type DatingApi, type DatingCard, type DatingErrorCode, type DatingProfileView, type DatingStatus, type Gender, type LikeResult, type MatchView,
} from './dating';
import type { InterestedIn } from './account';
import type { FakeSocialWorld } from './social-fakes';
import { takePage, type Page } from './social';
import type { FakePlace } from './fake-places';

/* In-memory dating used by MOCKED tests and the dev-only UI harness. It follows the documented rules, but it is not evidence
   that the database enforces anything: only tests/integration proves that. */

export interface FakeDating {
  gender: Gender | null; showGender: boolean; showDistance: boolean; interestedIn: InterestedIn[]; ageMin: number; ageMax: number; maxKm: number | null;
  discoverable: boolean; place: FakePlace | null; intention: string; interests: string[]; prompts: { question: string; answer: string }[]; bio: string; pronouns: string;
  filterIntentions: string[]; filterInterests: string[];
}
const DEFAULT: FakeDating = {
  gender: 'woman', showGender: true, showDistance: true, interestedIn: ['women', 'men', 'non-binary'], ageMin: 18, ageMax: 99, maxKm: null, discoverable: true,
  place: null, intention: 'long-term', interests: [], prompts: [], bio: '', pronouns: '', filterIntentions: [], filterInterests: [],
};
interface FMatch { id: string; a: string; b: string; seq: number; unmatched: boolean }

const BASE = Date.UTC(2026, 0, 1);
const stamp = (seq: number) => new Date(BASE + seq * 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
const pair = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
/** A deterministic 32-hex hash (two FNV passes). Only used to shuffle the fake deck per viewer and day. */
function hash32(s: string): string {
  let out = '';
  for (let k = 0; k < 4; k++) { let h = 0x811c9dc5 ^ (k * 0x9e3779b1); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } out += h.toString(16).padStart(8, '0'); }
  return out;
}
const err = (code: DatingErrorCode, m: string) => new DatingFailure(code, m);

export class FakeDatingWorld {
  dating = new Map<string, FakeDating>();
  actions = new Map<string, { action: 'like' | 'pass'; at: number }>();
  matches: FMatch[] = [];
  exclusions = new Set<string>();
  dailyCap: number = DATING_LIMITS.dailyLikes;
  today = '2026-06-01';
  now = () => Date.now();

  constructor(public social: FakeSocialWorld) {
    social.onBlock = (a, b) => { this.endMatch(a, b); this.exclusions.add(pair(a, b)); };
  }
  snapshot() { return { dating: [...this.dating], actions: [...this.actions], matches: this.matches, exclusions: [...this.exclusions] }; }
  restore(s: ReturnType<FakeDatingWorld['snapshot']>) { this.dating = new Map(s.dating); this.actions = new Map(s.actions); this.matches = s.matches; this.exclusions = new Set(s.exclusions); }
  setDating(id: string, d: Partial<FakeDating>) { this.dating.set(id, { ...DEFAULT, ...this.dating.get(id), ...d }); }
  d(id: string): FakeDating { return this.dating.get(id) ?? { ...DEFAULT, gender: null }; }
  activeMatch(a: string, b: string) { return this.matches.find((m) => !m.unmatched && m.a === (a < b ? a : b) && m.b === (a < b ? b : a)); }
  endMatch(a: string, b: string) { const m = this.activeMatch(a, b); if (m) m.unmatched = true; }
  place(id: string) { return this.d(id).place; }
  distance(v: string, t: string): number | null {
    const pv = this.place(v), pt = this.place(t);
    return pv && pt && this.d(t).showDistance ? haversineKm(pv, pt) : null;
  }
  /** The fake's single eligibility rule, mirroring public._dating_eligible(). */
  eligible(v: string, t: string, ignoreTargetPause = false): boolean {
    const sw = this.social, vu = sw.users.get(v), tu = sw.users.get(t), vd = this.d(v), td = this.d(t);
    if (!vu || !tu || v === t || !vu.completed || !tu.completed || vu.age < 18 || tu.age < 18) return false;
    if (sw.blockedBetween(v, t) || this.exclusions.has(pair(v, t)) || this.activeMatch(v, t)) return false;
    if (!vd.discoverable || (!td.discoverable && !ignoreTargetPause)) return false;
    if (!vd.gender || !td.gender) return false;
    if (!(wantsGender(td.gender, vd.interestedIn) && wantsGender(vd.gender, td.interestedIn))) return false;
    if (!(tu.age >= vd.ageMin && tu.age <= vd.ageMax && vu.age >= td.ageMin && vu.age <= td.ageMax)) return false;
    const lim = effectiveMaxKm(vd.maxKm), dist = this.distance(v, t);
    return !(lim !== null && dist !== null && dist >= lim);
  }
  tryMatch(a: string, b: string): FMatch | null {
    const ex = this.activeMatch(a, b); if (ex) return ex;
    if (this.actions.get(`${a}>${b}`)?.action !== 'like' || this.actions.get(`${b}>${a}`)?.action !== 'like') return null;
    if (!this.eligible(a, b) || !this.eligible(b, a)) return null;
    const m: FMatch = { id: crypto.randomUUID(), a: a < b ? a : b, b: a < b ? b : a, seq: this.social.next(), unmatched: false };
    this.matches.push(m); this.social.notify(a, b, 'match'); this.social.notify(b, a, 'match');
    return m;
  }
  /** Test helper: flips pause and, like the database trigger, reconciles inert mutual likes on resume. */
  setDiscoverable(id: string, on: boolean) {
    const was = this.d(id).discoverable; this.setDating(id, { discoverable: on });
    if (on && !was) for (const k of this.actions.keys()) { const [x, y] = k.split('>') as [string, string]; if (y === id) this.tryMatch(id, x); }
  }
}

export class FakeDatingApi implements DatingApi {
  calls: string[] = [];
  latencyMs = 0;
  private failing: { code: DatingErrorCode; times: number; only?: string } | null = null;
  constructor(public world: FakeDatingWorld, public me: string) {}
  failNext(code: DatingErrorCode, times = 1, only?: string) { this.failing = { code, times, only }; }
  private async gate(name: string) {
    this.calls.push(name);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failing && this.failing.times > 0 && (!this.failing.only || this.failing.only === name)) { this.failing.times--; throw err(this.failing.code, `fake ${this.failing.code}`); }
  }
  private name(id: string) { return this.world.social.users.get(id)?.name ?? 'Someone'; }
  private card(v: string, t: string, cursor = ''): DatingCard {
    const u = this.world.social.users.get(t)!, d = this.world.d(t), dist = this.world.distance(v, t);
    return {
      id: t, userId: t, displayName: u.name, username: u.name.toLowerCase().replace(/[^a-z0-9]+/g, '.'), age: u.age, gender: d.showGender ? d.gender : null, genderCustom: null, areaLabel: d.place?.name ?? 'Somewhere', distanceBucket: dist === null ? null : bucketOf(dist),
      intention: d.intention, interests: d.interests, prompts: d.prompts, photoPaths: [`${t}/main.jpg`], avatarPath: `${t}/main.jpg`, avatarCrop: null, details: {}, bio: d.bio, pronouns: this.world.activeMatch(v, t) ? d.pronouns : null, cursor,
    };
  }
  private paused() { return !this.world.d(this.me).discoverable; }

  async status(): Promise<DatingStatus> {
    await this.gate('status'); const d = this.world.d(this.me);
    const used = [...this.world.actions].filter(([k, v]) => k.startsWith(`${this.me}>`) && v.action === 'like' && this.world.now() - v.at < 86_400_000).length;
    return { paused: !d.discoverable, hasGender: d.gender !== null, hasPlace: !!d.place, likesLeft: Math.max(0, this.world.dailyCap - used), dailyCap: this.world.dailyCap };
  }
  async discover(cursor?: string | null): Promise<Page<DatingCard>> {
    await this.gate('discover');
    const c = safeDiscoverCursor(cursor); if (cursor && !c) throw err('invalid_cursor', 'That list is out of date. Reload to continue.');
    if (this.paused()) throw err('paused', 'Dating is paused.');
    if (!this.world.d(this.me).gender) throw err('profile_incomplete', 'Add your gender first.');
    const day = c ? c.split('|')[0]! : this.world.today, seed = `${this.me}:${day}:`;
    const me = this.world.d(this.me);
    const rows = [...this.world.social.users.keys()].filter((t) => {
      if (!this.world.eligible(this.me, t)) return false;
      const a = this.world.actions.get(`${this.me}>${t}`);
      if (a && (a.action === 'like' || this.world.now() - a.at < DATING_LIMITS.passDays * 86_400_000)) return false;
      const td = this.world.d(t);
      if (me.filterIntentions.length && !me.filterIntentions.includes(td.intention)) return false;
      return !me.filterInterests.length || td.interests.some((i) => me.filterInterests.includes(i));
    }).map((t) => ({ t, h: hash32(seed + t) })).sort((x, y) => (x.h < y.h ? -1 : x.h > y.h ? 1 : x.t < y.t ? -1 : 1))
      .filter((r) => !c || r.h > c.split('|')[1]! || (r.h === c.split('|')[1] && r.t > c.split('|')[2]!));
    return takePage(rows.slice(0, DATING_LIMITS.pageSize + 1).map((r) => this.card(this.me, r.t, `${day}|${r.h}|${r.t}`)), DATING_LIMITS.pageSize);
  }
  async profile(userId: string): Promise<DatingProfileView | null> {
    await this.gate('profile'); const m = this.world.activeMatch(this.me, userId);
    if (!m && !this.world.eligible(this.me, userId)) return null;
    const { cursor: _c, id: _i, ...rest } = this.card(this.me, userId); void _c; void _i;
    return { ...rest, isMatch: !!m, matchId: m?.id ?? null, matchedAt: m ? stamp(m.seq) : null };
  }
  async like(userId: string): Promise<LikeResult> {
    await this.gate('like'); const w = this.world;
    if (userId === this.me) throw err('invalid', 'You can’t like yourself.');
    if (this.paused()) throw err('paused', 'Dating is paused.');
    if (!w.d(this.me).gender) throw err('profile_incomplete', 'Add your gender first.');
    const ex = w.activeMatch(this.me, userId); if (ex) return { matched: true, matchId: ex.id };
    const already = w.actions.get(`${this.me}>${userId}`)?.action === 'like';
    if (!already && (await this.status()).likesLeft <= 0) throw err('daily_limit', 'That’s today’s limit.');
    if (!w.eligible(this.me, userId, true)) return { matched: false, matchId: null };
    if (!already) w.actions.set(`${this.me}>${userId}`, { action: 'like', at: w.now() });
    const m = w.tryMatch(this.me, userId);
    return { matched: !!m, matchId: m?.id ?? null };
  }
  async pass(userId: string) {
    await this.gate('pass');
    if (this.world.actions.get(`${this.me}>${userId}`)?.action !== 'like') this.world.actions.set(`${this.me}>${userId}`, { action: 'pass', at: this.world.now() });
  }
  async matches(cursor?: string | null): Promise<Page<MatchView>> {
    await this.gate('matches'); void cursor;
    const items = this.world.matches.filter((m) => !m.unmatched && (m.a === this.me || m.b === this.me)).sort((x, y) => y.seq - x.seq)
      .map((m): MatchView => { const o = m.a === this.me ? m.b : m.a; return { ...this.card(this.me, o, `${stamp(m.seq)}|${m.id}`), matchId: m.id, matchedAt: stamp(m.seq) }; });
    return { items, next: null };
  }
  async unmatch(matchId: string) {
    await this.gate('unmatch'); const m = this.world.matches.find((x) => x.id === matchId && !x.unmatched && (x.a === this.me || x.b === this.me));
    if (!m) throw err('not_found', 'That match no longer exists.');
    m.unmatched = true; this.world.exclusions.add(pair(m.a, m.b));
    this.world.social.notes = this.world.social.notes.filter((n) => n.type !== 'match' || !((n.recipient === m.a && n.actor === m.b) || (n.recipient === m.b && n.actor === m.a)));
  }
  displayName(id: string) { return this.name(id); }
}
