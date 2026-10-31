import { useEffect, useState, type ReactNode } from 'react';
import { MapPin, Sparkles } from 'lucide-react';
import { INTENTION_LABEL, bucketLabel, genderLabel, type DatingCard, type Intention, type MediaRef } from '@lovoki/core';
import { SocialImage } from '../social/parts';

/** Which images a card needs, so a deck can resolve them in one batched call. */
export const cardRefs = (c: DatingCard | undefined, all = true): MediaRef[] => (c ? c.photoPaths.slice(0, all ? 6 : 1).map((path) => ({ bucket: 'profile-photos' as const, path })) : []);

type CardLike = Pick<DatingCard, 'userId' | 'displayName' | 'age' | 'gender' | 'areaLabel' | 'distanceBucket' | 'intention' | 'interests' | 'prompts' | 'photoPaths' | 'bio' | 'pronouns'>;

/**
 * One person as the dating audience sees them. Only fields the database chose to return are rendered: nothing here can
 * show coordinates, a birth date, whether they liked you, or a distance finer than a bucket.
 */
export function DatingCardView({ card: p, urls, settled, menu, children }: { card: CardLike; urls: Map<string, string>; settled: boolean; menu?: ReactNode; children?: ReactNode }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [p.userId]);
  const path = p.photoPaths[idx];
  const prompt = p.prompts[0];
  const rest = p.prompts.slice(1);
  const dist = bucketLabel(p.distanceBucket);
  const gender = genderLabel(p.gender);
  return (
    <article className="discover-card" aria-label={`${p.displayName}, ${p.age}`} data-testid="dating-card" data-user-id={p.userId}>
      <div className="dc-photo">
        {path ? <SocialImage url={urls.get(path)} settled={settled} alt={`${p.displayName}, photo ${idx + 1} of ${p.photoPaths.length}`} />
          : <div className="photo ratio-45"><div className="photo-fallback"><span>No photo</span></div></div>}
        {p.photoPaths.length > 1 && <>
          <div className="dc-pager" aria-hidden>{p.photoPaths.map((x, i) => <span key={x} data-on={i === idx} />)}</div>
          <button type="button" className="dc-zone prev" aria-label="Previous photo" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} />
          <button type="button" className="dc-zone next" aria-label="Next photo" disabled={idx === p.photoPaths.length - 1} onClick={() => setIdx((i) => Math.min(p.photoPaths.length - 1, i + 1))} />
        </>}
      </div>
      {prompt && <div className="dc-note"><div className="q">{prompt.question}</div><blockquote className="break">{prompt.answer}</blockquote></div>}
      <div className="dc-body">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h2 className="dc-name grow">{p.displayName}<span className="age">, {p.age}</span></h2>
          {menu}
        </div>
        <div className="dc-meta">
          {(p.areaLabel || dist) && <span><MapPin size={16} aria-hidden /><span className="break">{[p.areaLabel, dist].filter(Boolean).join(' · ')}</span></span>}
          {gender && <span>{gender}</span>}
          {p.pronouns && <span data-testid="pronouns">{p.pronouns}</span>}
        </div>
        {p.bio && <p className="break" style={{ margin: 0 }}>{p.bio}</p>}
        <div className="chips">
          {p.intention && <span className="chip chip-dating">{INTENTION_LABEL[p.intention as Intention] ?? p.intention}</span>}
          {p.interests.map((i) => <span className="chip" key={i}>{i}</span>)}
        </div>
        {rest.map((q) => <div key={q.question} className="dc-note" style={{ margin: 0 }}><div className="q">{q.question}</div><blockquote className="break">{q.answer}</blockquote></div>)}
        {dist && <p className="subtle" style={{ margin: 0 }}><Sparkles size={12} aria-hidden /> Distance is approximate and shown in ranges only.</p>}
      </div>
      {children}
    </article>
  );
}
