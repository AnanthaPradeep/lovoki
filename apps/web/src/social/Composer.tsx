import { useEffect, useRef, useState } from 'react';
import { Globe, ImagePlus, Users, X } from 'lucide-react';
import { SOCIAL_RULES, SocialFailure, SubmitGuard, audienceCopy, charCount, validateCaption, type Audience } from '@lovoki/core';
import { Counter, Dialog, Notice, useToast } from '../ui';
import { useReadyAccount } from '../account/AccountProvider';
import { preparePostImage, type PreparedPostImage } from '../data/image';
import { useSocial } from './SocialProvider';

/**
 * New post. The post id is chosen once per composer session, so a retry after a lost response re-sends the SAME id
 * and the database returns the existing post instead of creating a second one.
 */
export function Composer({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const { api } = useSocial();
  const { account } = useReadyAccount();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<{ prepared: PreparedPostImage; preview: string } | null>(null);
  const [audience, setAudience] = useState<Audience>(account.socialVisibility);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const postId = useRef(crypto.randomUUID());
  const guard = useRef(new SubmitGuard()).current;
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.preview); }, [image]);

  const reset = () => { setCaption(''); setImage(null); setErr(null); setAudience(account.socialVisibility); postId.current = crypto.randomUUID(); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null); setReading(true);
    try { const prepared = await preparePostImage(file); setImage({ prepared, preview: URL.createObjectURL(prepared.blob) }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That image couldn’t be used.'); }
    finally { setReading(false); }
  };

  const copy = audienceCopy(audience, account.socialVisibility);
  const bad = validateCaption(caption, !!image);

  const publish = () => {
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    void guard.run('publish', async () => {
      try {
        await api.createPost({ id: postId.current, caption, audience, image: image?.prepared.blob ?? null, thumb: image?.prepared.thumb ?? null, size: image ? { width: image.prepared.width, height: image.prepared.height } : null, blurhash: image?.prepared.blurhash ?? null });
        toast({ text: audience === 'public' && account.socialVisibility === 'public' ? 'Posted. Anyone on LOVOKI can see it.' : 'Posted for your followers.' });
        reset(); onClose(); onPosted();
      } catch (e) { setErr(e instanceof SocialFailure ? e.message : 'Couldn’t post. Your post is still here, so you can try again.'); }
      finally { setBusy(false); }
    });
  };

  return (
    <Dialog open={open} onClose={close} title="New post"
      footer={<><button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={publish} disabled={busy || reading} aria-busy={busy}>{busy ? 'Posting…' : err && !bad ? 'Try again' : 'Post'}</button></>}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="post-file"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {image ? (
        <div className="composer-preview"><div className="photo ratio-45"><img src={image.preview} alt="Preview of your photo" /></div>
          <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => setImage(null)}><X size={18} aria-hidden /></button></div>
      ) : (
        <button type="button" className="dropzone" onClick={() => fileRef.current?.click()} disabled={reading}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
          <ImagePlus size={28} aria-hidden /><span><b>{reading ? 'Preparing your photo…' : 'Add a photo'}</b>{!reading && ' (optional)'}</span>
          <span className="subtle">JPG, PNG or WebP. It’s resized and stripped of location data before upload.</span>
        </button>
      )}
      <div className="field">
        <label htmlFor="post-caption">Caption</label>
        <textarea id="post-caption" className="textarea" value={caption} onChange={(e) => { setCaption(e.target.value); setErr(null); }} placeholder="What’s the story behind it?" aria-describedby="post-caption-count" />
        <div id="post-caption-count"><Counter value={charCount(caption)} max={SOCIAL_RULES.captionMax} /></div>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="field">
        <legend className="label" style={{ marginBottom: 8 }}>Who can see this</legend>
        <div className="radio-cards">
          <label className="radio-card" style={{ minHeight: 44 }}><input type="radio" name="aud" checked={audience === 'public'} onChange={() => setAudience('public')} />
            <span><Globe size={16} aria-hidden /> Public<small>Anyone on LOVOKI</small></span></label>
          <label className="radio-card" style={{ minHeight: 44 }}><input type="radio" name="aud" checked={audience === 'followers'} onChange={() => setAudience('followers')} />
            <span><Users size={16} aria-hidden /> Followers<small>People you accept</small></span></label>
        </div>
        <span className="hint" data-testid="audience-copy"><b>{copy.title}.</b> {copy.detail}</span>
        {copy.warning && <Notice tone="warning">{copy.warning}</Notice>}
        <span className="hint">Dating likes and matches never appear on posts or profiles here.</span>
      </fieldset>
      {err && <Notice tone="error">{err}</Notice>}
    </Dialog>
  );
}
