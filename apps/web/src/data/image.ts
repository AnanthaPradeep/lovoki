import { encode } from 'blurhash';
import { PHOTO_RULES, SOCIAL_RULES, sniffImageType, validatePhotoInput, validateStoredPhoto } from '@lovoki/core';

/**
 * Validates by content (magic bytes), then decodes and re-encodes as JPEG at a bounded size.
 * Re-encoding strips EXIF metadata, including GPS coordinates, and fixes orientation.
 * This is a convenience and privacy measure. The server independently enforces type, size and path.
 */
export async function prepareImage(file: File): Promise<Blob> {
  const early = validatePhotoInput(file);
  if (early) throw new Error(early);
  const kind = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!kind) throw new Error('That file isn’t a JPG, PNG or WebP image.');
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image couldn’t be read. Try a different one.'); }
  if (Math.min(bmp.width, bmp.height) < 400) { bmp.close(); throw new Error('Choose a larger image: at least 400 pixels on the short side.'); }
  const scale = Math.min(1, PHOTO_RULES.maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bmp.close(); throw new Error('Your browser can’t process images here.'); }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) throw new Error('This image couldn’t be processed. Try a different one.');
  const stored = validateStoredPhoto(blob);
  if (stored) throw new Error(stored);
  return blob;
}

/* ------------------------------------------------------------ Phase 4.5: thumbnails and blurhash */
export interface PreparedPostImage { blob: Blob; thumb: Blob; width: number; height: number; blurhash: string }

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q));

/** A 4x3 blurhash of any bitmap, computed from a 32 px copy (cheap, and plenty for a placeholder). */
export function blurhashOfBitmap(bmp: ImageBitmap): string {
  const w = 32, h = Math.max(1, Math.round((32 * bmp.height) / bmp.width));
  const c = document.createElement('canvas'); c.width = w; c.height = Math.min(h, 48);
  const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return encode(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 4, 3);
}

/**
 * The post pipeline: the same validation and EXIF-stripping re-encode as profile photos, plus a thumbnail (about 400 px wide)
 * and a blurhash. Thumbnails exist so a profile grid never downloads originals. Supabase image transformations are not used
 * (not available on the free plan), so this is done in the browser.
 */
export async function preparePostImage(file: File): Promise<PreparedPostImage> {
  const blob = await prepareImage(file);
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, SOCIAL_RULES.thumbMaxPx / bmp.width, 600 / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('Your browser can’t process images here.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
    const thumb = await toBlob(c, 0.8); if (!thumb) throw new Error('This image couldn’t be processed. Try a different one.');
    return { blob, thumb, width: bmp.width, height: bmp.height, blurhash: blurhashOfBitmap(bmp) };
  } finally { bmp.close(); }
}

/** Blurhash of an already-stored photo (for the avatar). Null when the browser may not read the pixels; the avatar then just has no placeholder. */
export async function blurhashFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url); if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    try { return blurhashOfBitmap(bmp); } finally { bmp.close(); }
  } catch { return null; }
}
