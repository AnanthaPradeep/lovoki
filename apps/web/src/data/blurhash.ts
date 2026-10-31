import { decode } from 'blurhash';
import { isBlurhash } from '@lovoki/core';

const cache = new Map<string, string>();

/** A tiny PNG data URL for a blurhash, drawn once and cached. Anything that is not a valid blurhash yields undefined. */
export function blurhashDataUrl(hash: string | null | undefined, w = 32, h = 32): string | undefined {
  if (!isBlurhash(hash)) return undefined;
  const k = `${hash}:${w}x${h}`; const hit = cache.get(k); if (hit) return hit;
  try {
    const px = decode(hash, w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) return undefined;
    const img = ctx.createImageData(w, h); img.data.set(px); ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png'); cache.set(k, url); return url;
  } catch { return undefined; }
}
