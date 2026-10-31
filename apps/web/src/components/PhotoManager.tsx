import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, RotateCw, Star, Trash2, X } from 'lucide-react';
import { AccountFailure, PHOTO_RULES, type Account, type AccountApi, type AccountPhoto } from '@lovoki/core';
import { prepareImage } from '../data/image';
import { ConfirmDialog, Notice } from '../ui';
import { SignedPhoto } from '../ui/fields';

interface Upload { key: string; name: string; status: 'preparing' | 'uploading' | 'failed'; blob?: Blob; previewUrl?: string; error?: string }

export function PhotoManager({ account, api, reload }: { account: Account; api: AccountApi; reload: () => Promise<Account> }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AccountPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => { const u = urls.current; return () => { u.forEach((x) => URL.revokeObjectURL(x)); }; }, []);

  const photos = account.photos;
  const total = photos.length + uploads.length;
  const completed = !!account.onboarding.completedAt;
  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const drop = (key: string) => setUploads((u) => u.filter((x) => x.key !== key));
  const msg = (e: unknown) => (e instanceof AccountFailure || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  async function send(key: string, blob: Blob) {
    patch(key, { status: 'uploading', error: undefined });
    try { await api.uploadPhoto(blob); await reload(); drop(key); }
    catch (e) { patch(key, { status: 'failed', error: msg(e) }); }
  }
  async function processOne(file: File) {
    const key = crypto.randomUUID();
    setUploads((u) => [...u, { key, name: file.name, status: 'preparing' }]);
    try {
      const blob = await prepareImage(file);
      const previewUrl = URL.createObjectURL(blob); urls.current.add(previewUrl);
      patch(key, { blob, previewUrl, status: 'uploading' });
      await send(key, blob);
    } catch (e) { patch(key, { status: 'failed', error: msg(e) }); }
  }
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null);
    const room = Math.max(0, PHOTO_RULES.maxCount - total);
    const list = Array.from(files);
    if (list.length > room) setNotice(room === 0 ? `You already have ${PHOTO_RULES.maxCount} photos. Remove one to add another.` : `Only ${room} more photo${room === 1 ? '' : 's'} fit. The rest were skipped.`);
    for (const f of list.slice(0, room)) await processOne(f);
  }
  async function mutate(id: string, fn: () => Promise<void>) {
    setBusyId(id); setNotice(null);
    try { await fn(); await reload(); }
    catch (e) { setNotice(msg(e)); try { await reload(); } catch { /* keep showing the last known state */ } }
    finally { setBusyId(null); }
  }
  const reorder = (ids: string[], moved: string) => mutate(moved, () => api.reorderPhotos(ids));
  const move = (i: number, d: -1 | 1) => { const ids = photos.map((p) => p.id); const j = i + d; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; void reorder(ids, photos[i]!.id); };
  const makePrimary = (i: number) => { const ids = photos.map((p) => p.id); const [id] = ids.splice(i, 1); void reorder([id!, ...ids], id!); };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      {notice && <Notice tone="error">{notice}</Notice>}
      <ul className="photo-grid" aria-label={`Your photos, ${photos.length} of ${PHOTO_RULES.maxCount}`}>
        {photos.map((p, i) => {
          const n = i + 1, busy = busyId === p.id;
          return (
            <li key={p.id} className="photo-tile" data-busy={busy}>
              <SignedPhoto path={p.path} alt={`Your photo ${n}`} api={api} />
              {i === 0 && <span className="photo-badge">Main photo</span>}
              <div className="photo-actions">
                <button type="button" className="icon-btn" disabled={i === 0 || !!busyId} aria-label={`Move photo ${n} earlier`} onClick={() => move(i, -1)}><ChevronLeft size={18} aria-hidden /></button>
                <button type="button" className="icon-btn" disabled={i === photos.length - 1 || !!busyId} aria-label={`Move photo ${n} later`} onClick={() => move(i, 1)}><ChevronRight size={18} aria-hidden /></button>
                <button type="button" className="icon-btn" disabled={i === 0 || !!busyId} aria-label={`Make photo ${n} your main photo`} onClick={() => makePrimary(i)}><Star size={18} aria-hidden /></button>
                <button type="button" className="icon-btn" disabled={!!busyId || (completed && photos.length <= 1)} aria-label={`Remove photo ${n}`}
                  title={completed && photos.length <= 1 ? 'Keep at least one photo' : undefined} onClick={() => setRemoving(p)}><Trash2 size={18} aria-hidden /></button>
              </div>
            </li>
          );
        })}
        {uploads.map((u) => (
          <li key={u.key} className="photo-tile" aria-live="polite">
            <div className="photo ratio-45">{u.previewUrl ? <img src={u.previewUrl} alt="" /> : <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />}</div>
            <div className="photo-status" data-failed={u.status === 'failed'}>
              {u.status !== 'failed' ? <><span className="spinner" aria-hidden /><span>{u.status === 'preparing' ? 'Preparing…' : 'Uploading…'}</span></> : (
                <><span className="photo-error">{u.error}</span>
                  <span className="row" style={{ gap: 6 }}>
                    {u.blob && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send(u.key, u.blob!)}><RotateCw size={14} aria-hidden />Retry</button>}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => drop(u.key)}><X size={14} aria-hidden />Dismiss</button></span></>)}
            </div>
          </li>
        ))}
        {total < PHOTO_RULES.maxCount && (
          <li><button type="button" className="photo-add" onClick={() => fileRef.current?.click()}><ImagePlus size={26} aria-hidden /><span>Add photo</span><span className="subtle">{total} of {PHOTO_RULES.maxCount}</span></button></li>
        )}
      </ul>
      <p className="subtle">JPG, PNG or WebP. Photos are resized and re-saved in your browser, which removes hidden location data. They’re stored privately and only shown according to your visibility settings.</p>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Remove this photo?" confirmLabel="Remove photo"
        body="It will be deleted from your profile and from storage."
        onConfirm={() => { const p = removing; if (p) void mutate(p.id, () => api.deletePhoto(p.id)); }} />
    </div>
  );
}
