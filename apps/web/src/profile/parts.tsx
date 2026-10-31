import { useEffect, useRef, useState } from 'react';
import { describeDetails, type AccountApi, type AccountPhoto, type AvatarCrop, type VisibleDetails } from '@lovoki/core';
import { Notice, useToast } from '../ui';
import { cropStyle } from '../social/parts';
import { SignedPhoto } from '../ui/fields';
import { blurhashFromUrl } from '../data/image';

/** The placeholder for an avatar. Never blocks saving: if the browser cannot read the pixels, the avatar simply has none. */
async function avatarBlurhash(api: Pick<AccountApi, 'photoUrl'>, path: string | undefined): Promise<string | null> {
  if (!path) return null;
  try { return await blurhashFromUrl(await api.photoUrl(path)); } catch { return null; }
}

/** The optional details this viewer is allowed to see, as a plain list. The database already removed everything else. */
export function DetailList({ details }: { details: VisibleDetails }) {
  const lines = describeDetails(details);
  if (!lines.length) return null;
  return (
    <dl className="stack" style={{ gap: 6, margin: 0 }} data-testid="detail-list" aria-label="More about them">
      {lines.map((l) => (
        <div key={l.key} className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <dt className="subtle" style={{ minWidth: 112 }}>{l.label}</dt><dd className="break" style={{ margin: 0 }} data-detail={l.key}>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Choose which photo is your avatar, and how it is cropped into a circle. Saved only when you press Save. */
export function AvatarEditor({ account, api, reload }: { account: { photos: AccountPhoto[]; avatarPhotoId: string | null; avatarCrop: AvatarCrop | null }; api: Pick<AccountApi, 'saveAvatar' | 'photoUrl'>; reload: () => Promise<unknown> }) {
  const toast = useToast();
  const mainId = account.photos[0]?.id ?? null;
  const [photoId, setPhotoId] = useState<string | null>(account.avatarPhotoId ?? mainId);
  const [crop, setCrop] = useState<AvatarCrop>(account.avatarCrop ?? { x: 0.5, y: 0.5, zoom: 1 });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const photo = account.photos.find((p) => p.id === photoId) ?? account.photos[0];
  useEffect(() => { setPhotoId(account.avatarPhotoId ?? mainId); setCrop(account.avatarCrop ?? { x: 0.5, y: 0.5, zoom: 1 }); }, [account.avatarPhotoId, account.avatarCrop, mainId]);
  useEffect(() => { let alive = true; setUrl(null); if (photo) api.photoUrl(photo.path).then((u) => { if (alive) setUrl(u); }).catch(() => undefined); return () => { alive = false; }; }, [photo, api]);
  if (!account.photos.length) return <p className="subtle">Add a photo first, then you can choose your avatar.</p>;
  const dirty = (photoId ?? null) !== (account.avatarPhotoId ?? mainId) || JSON.stringify(crop) !== JSON.stringify(account.avatarCrop ?? { x: 0.5, y: 0.5, zoom: 1 });

  const save = async (reset = false) => {
    if (lock.current) return; lock.current = true; setBusy(true); setErr(null);
    try { const hash = reset || !photoId ? null : await avatarBlurhash(api, account.photos.find((x) => x.id === photoId)?.path); await api.saveAvatar(reset ? null : photoId, reset ? null : crop, hash); await reload(); toast({ text: reset ? 'Avatar reset to your main photo.' : 'Avatar saved.' }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t save your avatar.'); } finally { lock.current = false; setBusy(false); }
  };
  const slider = (k: keyof AvatarCrop, label: string, min: number, max: number, step: number) => (
    <label className="field" style={{ gap: 4 }}><span className="subtle" style={{ fontWeight: 600 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) })} aria-label={label} /></label>);

  return (
    <div className="stack" style={{ gap: 12 }} data-testid="avatar-editor">
      <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="avatar" style={{ width: 96, height: 96, overflow: 'hidden' }} aria-label="Avatar preview" role="img">
          {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', ...cropStyle(crop) }} /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
        </div>
        <div className="stack grow" style={{ gap: 8, minWidth: 200 }}>
          <label className="field" style={{ gap: 4 }}><span className="subtle" style={{ fontWeight: 600 }}>Photo</span>
            <select className="select" value={photoId ?? ''} onChange={(e) => setPhotoId(e.target.value)} aria-label="Avatar photo">
              {account.photos.map((p, i) => <option key={p.id} value={p.id}>{i === 0 ? 'Photo 1 (main)' : `Photo ${i + 1}`}</option>)}
            </select></label>
          {slider('zoom', 'Zoom', 1, 3, 0.1)}{slider('x', 'Move left or right', 0, 1, 0.05)}{slider('y', 'Move up or down', 0, 1, 0.05)}
        </div>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} aria-busy={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save avatar'}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || (!account.avatarPhotoId && !account.avatarCrop)} onClick={() => void save(true)}>Use my main photo</button>
      </div>
      <p className="subtle">Your avatar is the small round picture next to your name. The first photo is used until you choose another. Saved separately from the other changes.</p>
    </div>
  );
}

export { SignedPhoto };
