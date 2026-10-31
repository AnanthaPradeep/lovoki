// Deterministic art for SAMPLE content only. No photographs, no real people, no generated faces.
//   * Post and "photo" images: eight generated compositions (horizon, circles, waves, mountains, arches, dots, grid, stripes)
//     drawn from a seeded palette. Same seed, same picture, byte for byte.
//   * Avatars: illustrated people from DiceBear styles whose ARTWORK licence is CC0 1.0 (Lorelei, Notionists, Open Peeps),
//     read from each package's LICENSE file. See docs/SAMPLE_CONTENT.md.
import { createRequire } from 'node:module';
import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import * as notionists from '@dicebear/notionists';
import * as openPeeps from '@dicebear/open-peeps';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { encode } = require('blurhash');

export const AVATAR_STYLES = [
  { id: 'lorelei', style: lorelei, creator: 'Lisa Wischofsky', license: 'CC0 1.0' },
  { id: 'notionists', style: notionists, creator: 'Zoish', license: 'CC0 1.0' },
  { id: 'open-peeps', style: openPeeps, creator: 'Pablo Stanley', license: 'CC0 1.0' },
];

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashSeed = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h) % 360},${Math.round(s)}%,${Math.round(l)}%,${a})`;
function palette(r) {
  const base = r() * 360;
  return { bg1: hsl(base, 55 + r() * 25, 78 + r() * 12), bg2: hsl(base + 40 + r() * 40, 50 + r() * 30, 62 + r() * 14), a: hsl(base + 180, 55, 40 + r() * 15), b: hsl(base + 20, 70, 55 + r() * 10), c: hsl(base + 300, 45, 30 + r() * 12), ink: hsl(base + 200, 40, 18) };
}
const f = (n) => n.toFixed(1);

const COMPOSITIONS = {
  horizon: (r, w, h, p) => {
    const hz = h * (0.55 + r() * 0.15); const sx = w * (0.25 + r() * 0.5); const sr = w * (0.1 + r() * 0.08);
    return `<rect width="${w}" height="${hz}" fill="url(#g)"/><circle cx="${f(sx)}" cy="${f(hz - sr * 0.4)}" r="${f(sr)}" fill="${p.b}"/><rect y="${hz}" width="${w}" height="${h - hz}" fill="${p.a}"/>`
      + Array.from({ length: 6 }, (_, i) => `<rect x="${f(w * (0.1 + r() * 0.8))}" y="${f(hz + 8 + i * ((h - hz) / 7))}" width="${f(w * (0.1 + r() * 0.25))}" height="5" rx="2.5" fill="${p.bg1}" opacity="0.55"/>`).join('');
  },
  circles: (r, w, h, p) => `<rect width="${w}" height="${h}" fill="url(#g)"/>` + Array.from({ length: 9 }, (_, i) => `<circle cx="${f(r() * w)}" cy="${f(r() * h)}" r="${f(w * (0.08 + r() * 0.22))}" fill="${[p.a, p.b, p.c][i % 3]}" opacity="${f(0.35 + r() * 0.4)}"/>`).join(''),
  waves: (r, w, h, p) => `<rect width="${w}" height="${h}" fill="url(#g)"/>` + Array.from({ length: 7 }, (_, i) => {
    const y = h * (0.25 + i * 0.1); const amp = 18 + r() * 40; const k = 1 + r() * 2.5; const pts = [];
    for (let x = 0; x <= w; x += 20) pts.push(`${x},${f(y + Math.sin((x / w) * Math.PI * 2 * k + i) * amp)}`);
    return `<polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="${[p.a, p.b, p.c][i % 3]}" opacity="0.55"/>`;
  }).join(''),
  mountains: (r, w, h, p) => `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${f(w * (0.2 + r() * 0.6))}" cy="${f(h * 0.2)}" r="${f(w * 0.07)}" fill="${p.bg1}"/>` + Array.from({ length: 4 }, (_, i) => {
    const base = h * (0.55 + i * 0.12); const pts = [`0,${h}`]; let x = -w * 0.1;
    while (x < w * 1.1) { pts.push(`${f(x)},${f(base - (0.08 + r() * 0.22) * h * (1 - i * 0.18))}`); x += w * (0.15 + r() * 0.2); }
    pts.push(`${w},${h}`); return `<polygon points="${pts.join(' ')}" fill="${[p.c, p.a, p.b, p.ink][i]}" opacity="${f(0.55 + i * 0.12)}"/>`;
  }).join(''),
  arches: (r, w, h, p) => `<rect width="${w}" height="${h}" fill="url(#g)"/>` + Array.from({ length: 6 }, (_, i) => {
    const rad = w * (0.52 - i * 0.075); return `<path d="M ${f(w / 2 - rad)} ${h} A ${f(rad)} ${f(rad)} 0 0 1 ${f(w / 2 + rad)} ${h} Z" fill="${[p.a, p.b, p.c, p.bg1, p.a, p.b][i]}" opacity="0.85"/>`;
  }).join(''),
  dots: (r, w, h, p) => { const step = 54 + Math.round(r() * 30); let s = `<rect width="${w}" height="${h}" fill="url(#g)"/>`;
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) { const d = Math.hypot(x - w / 2, y - h / 2) / Math.hypot(w / 2, h / 2); s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(step * 0.42 * (1 - d * 0.8))}" fill="${p.c}" opacity="0.7"/>`; } return s; },
  grid: (r, w, h, p) => { const n = 4 + Math.floor(r() * 3); const cw = w / n; const ch = h / Math.round(h / cw); let s = '';
    for (let y = 0; y < h; y += ch) for (let x = 0; x < w; x += cw) s += `<rect x="${f(x + 6)}" y="${f(y + 6)}" width="${f(cw - 12)}" height="${f(ch - 12)}" rx="${f(cw * (r() * 0.5))}" fill="${[p.a, p.b, p.c, p.bg1, p.bg2][Math.floor(r() * 5)]}"/>`; return s; },
  stripes: (r, w, h, p) => `<rect width="${w}" height="${h}" fill="url(#g)"/>` + Array.from({ length: 12 }, (_, i) => `<rect x="${f(-w * 0.2 + i * (w * 0.14))}" y="${f(-h * 0.1)}" width="${f(w * (0.04 + r() * 0.07))}" height="${f(h * 1.4)}" fill="${[p.a, p.b, p.c][i % 3]}" opacity="0.6" transform="rotate(${f(18 + r() * 8)} ${f(w / 2)} ${f(h / 2)})"/>`).join('')
    + `<circle cx="${f(w * (0.3 + r() * 0.4))}" cy="${f(h * (0.3 + r() * 0.4))}" r="${f(w * 0.16)}" fill="${p.bg1}" opacity="0.9"/>`,
};
export const COMPOSITION_NAMES = Object.keys(COMPOSITIONS);

/** An SVG string for one artwork. `kind` picks the composition; the seed picks everything else. */
export function artSvg(seed, w, h, kind) {
  const r = rng(hashSeed(String(seed))); const p = palette(r);
  const name = kind ?? COMPOSITION_NAMES[Math.floor(r() * COMPOSITION_NAMES.length)];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="${r() > 0.5 ? 1 : 0}" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient></defs>${COMPOSITIONS[name](r, w, h, p)}</svg>`;
}

/** One avatar illustration. The same seed always gives the same person. */
export function avatarSvg(seed, styleIndex, bg) {
  const s = AVATAR_STYLES[styleIndex % AVATAR_STYLES.length];
  // Friendly expressions only (the defaults include grimaces). Per-style option names come from each style's schema.
  const friendly = { lorelei: { mouth: ['happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy07', 'happy08'], eyebrows: ['variant01', 'variant02', 'variant03', 'variant04', 'variant05'] },
    notionists: { lips: ['variant01', 'variant02', 'variant03', 'variant04', 'variant05', 'variant06', 'variant07', 'variant08'] },
    'open-peeps': { face: ['smile', 'smileBig', 'calm', 'cute', 'smileTeethGap', 'eatingHappy', 'lovingGrin1'] } }[s.id];
  return createAvatar(s.style, { seed: String(seed), backgroundColor: [bg], radius: 0, ...friendly }).toString();
}

const jpeg = (svg, w, h, q) => sharp(Buffer.from(svg)).resize(w, h, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();

/** blurhash of an image buffer (4x3 components from a 32 px copy). */
export async function blurhashOf(buf) {
  const { data, info } = await sharp(buf).resize(32, 32, { fit: 'cover' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

/** original + thumbnail (400 px wide) + blurhash for a post picture. */
export async function postPicture(seed, square) {
  const w = 1080, h = square ? 1080 : 1350;
  const original = await jpeg(artSvg(seed, w, h), w, h, 78);
  const tw = 400, th = square ? 400 : 500;
  const thumb = await sharp(original).resize(tw, th, { fit: 'cover' }).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  return { original, thumb, width: w, height: h, blurhash: await blurhashOf(thumb), bytes: original.length };
}

/** A profile photo: index 0 is the illustrated avatar, the rest are generated scenes (4:5). */
export async function profilePicture(seed, index, avatarSeed, avatarStyle) {
  const w = 800, h = index === 0 ? 800 : 1000;
  const bg = ['f6d5e3', 'fde2c8', 'd9e8f6', 'e3f1d4', 'e8dcf6'][hashSeed(`${seed}:bg`) % 5];
  const svg = index === 0 ? avatarSvg(avatarSeed, avatarStyle, bg) : artSvg(`${seed}:photo:${index}`, w, h);
  const buf = await jpeg(svg, w, h, 80);
  return { buf, blurhash: index === 0 ? await blurhashOf(buf) : null };
}
