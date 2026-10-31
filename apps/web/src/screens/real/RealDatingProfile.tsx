import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, MessageCircle, UserX, X } from 'lucide-react';
import { DatingFailure, matchedAgo, type DatingCard, type DatingProfileView } from '@lovoki/core';
import { ConfirmDialog, EmptyState, Notice, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { LoadError, PostSkeletons } from '../../social/parts';
import { DatingCardView, cardRefs } from '../../dating/DatingCardView';
import { MatchDialog } from '../../dating/DatingDialogs';

/** One person in the dating context: a stranger who is eligible for you (like or pass) or a current match (matched-only fields, unmatch). */
export function RealDatingProfile() {
  const { id = '' } = useParams();
  const { dating, refreshUnread } = useSocial();
  const toast = useToast();
  const nav = useNavigate();
  const [st, setSt] = useState<{ k: 'loading' } | { k: 'error'; m: string } | { k: 'missing' } | { k: 'ready'; p: DatingProfileView }>({ k: 'loading' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [matched, setMatched] = useState<DatingCard | null>(null);
  const load = useCallback(() => {
    setSt({ k: 'loading' });
    dating.profile(id).then((p) => setSt(p ? { k: 'ready', p } : { k: 'missing' })).catch((e) => setSt({ k: 'error', m: e instanceof DatingFailure ? e.message : 'Couldn’t load this profile.' }));
  }, [dating, id]);
  useEffect(() => { load(); }, [load]);

  const p = st.k === 'ready' ? st.p : null;
  useTitle(p ? p.displayName : 'Profile');
  const card = useMemo(() => (p ? { ...p, id: p.userId, cursor: '' } : undefined), [p]);
  const refs = useMemo(() => cardRefs(card), [card]);
  const { urls, settled } = useMediaUrls(refs);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast({ text: e instanceof DatingFailure ? e.message : 'That didn’t work. Try again.', tone: 'error' }); } finally { setBusy(false); }
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <Link to={p?.isMatch ? '/connections?tab=matches' : '/discover'} className="back"><ArrowLeft size={18} aria-hidden />{p?.isMatch ? 'Matches' : 'Discover'}</Link>
      {st.k === 'loading' && <PostSkeletons count={1} />}
      {st.k === 'error' && <LoadError message={st.m} onRetry={load} />}
      {st.k === 'missing' && <EmptyState icon={<UserX size={28} />} title="This person isn’t available" body="They may have paused, unmatched, or you may no longer be able to see each other." action={<Link to="/discover" className="btn btn-primary">Back to Discover</Link>} />}
      {p && card && (
        <DatingCardView card={p} urls={urls} settled={settled}>
          {p.isMatch ? (
            <div className="stack" style={{ gap: 12, marginTop: 16 }}>
              <Notice>You matched {p.matchedAt ? matchedAgo(p.matchedAt) : ''}. Pronouns and your match date are only visible to matches.</Notice>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" disabled aria-disabled="true" aria-describedby="say-hello-note"><MessageCircle size={18} aria-hidden />Say hello</button>
                <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>Unmatch</button>
              </div>
              <p className="subtle" id="say-hello-note">Messaging arrives in Phase 5.</p>
            </div>
          ) : (
            <div className="dc-actions">
              <button type="button" className="round" aria-label={`Pass on ${p.displayName}`} disabled={busy} onClick={() => void run(async () => { await dating.pass(p.userId); nav('/discover'); })}><X size={28} aria-hidden /></button>
              <button type="button" className="round like" aria-label={`Like ${p.displayName}`} disabled={busy} onClick={() => void run(async () => {
                const r = await dating.like(p.userId);
                if (r.matched) { setMatched(card); refreshUnread(); load(); } else { toast({ text: `You liked ${p.displayName}. They’ll only know if they like you too.` }); nav('/discover'); }
              })}><Heart size={30} fill="currentColor" aria-hidden /></button>
            </div>
          )}
        </DatingCardView>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={`Unmatch with ${p?.displayName ?? 'them'}?`} confirmLabel="Unmatch"
        body="You’ll both disappear from each other’s Matches and Discover for good. They aren’t told, and this can’t be undone."
        onConfirm={() => void run(async () => { if (p?.matchId) await dating.unmatch(p.matchId); toast({ text: 'Unmatched.' }); nav('/connections?tab=matches'); })} />
      <MatchDialog card={matched} onClose={() => setMatched(null)} />
    </div>
  );
}
