import { MapPin } from 'lucide-react';
import { INTENTION_LABEL, type Account, type AccountApi } from '@lovoki/core';
import { SignedPhoto } from '../ui/fields';

/** How the profile reads to someone else. Uses age, never date of birth. */
export function ProfilePreview({ account, api }: { account: Account; api: AccountApi }) {
  const first = account.photos[0];
  const prompt = account.prompts[0];
  return (
    <article className="discover-card" style={{ maxWidth: 420 }} aria-label="Profile preview">
      <div className="dc-photo">
        {first ? <SignedPhoto path={first.path} alt="Your main photo" api={api} /> : <div className="photo ratio-45"><div className="photo-fallback"><span>No photo yet</span></div></div>}
      </div>
      {prompt && <div className="dc-note"><div className="q">{prompt.question}</div><blockquote>{prompt.answer}</blockquote></div>}
      <div className="dc-body">
        <h2 className="dc-name">{account.displayName || 'Your name'}{account.age !== null && <span className="age">, {account.age}</span>}</h2>
        <div className="dc-meta">
          {account.areaLabel && <span><MapPin size={16} aria-hidden /><span className="break">{account.areaLabel}</span></span>}
          {account.pronouns && <span>{account.pronouns}</span>}
        </div>
        {account.bio && <p className="break">{account.bio}</p>}
        <div className="chips">
          {account.intention && <span className="chip chip-dating">{INTENTION_LABEL[account.intention]}</span>}
          {account.interests.map((i) => <span key={i} className="chip">{i}</span>)}
        </div>
      </div>
    </article>
  );
}
