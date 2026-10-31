export const PHOTO_BUCKET = 'profile-photos';
export const PHOTO_RULES = {
  /** What a person may pick. Photos are re-encoded in the browser before upload. */
  maxInputBytes: 15 * 1024 * 1024,
  /** What storage accepts. Mirrors the bucket's file_size_limit in the migration. */
  maxStoredBytes: 5 * 1024 * 1024,
  maxCount: 6,
  maxEdge: 1600,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
export type PhotoType = (typeof PHOTO_RULES.allowedTypes)[number];

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;

/** Checks what the person picked, before any processing. The server re-checks what is stored. */
export function validatePhotoInput(f: { type: string; size: number }): string | null {
  if (!(PHOTO_RULES.allowedTypes as readonly string[]).includes(f.type)) return 'Use a JPG, PNG or WebP image.';
  if (f.size <= 0) return 'That file is empty.';
  if (f.size > PHOTO_RULES.maxInputBytes) return `That image is over ${mb(PHOTO_RULES.maxInputBytes)}. Choose a smaller one.`;
  return null;
}

export function validateStoredPhoto(f: { type: string; size: number }): string | null {
  if (!(PHOTO_RULES.allowedTypes as readonly string[]).includes(f.type)) return 'Use a JPG, PNG or WebP image.';
  if (f.size <= 0) return 'That file is empty.';
  if (f.size > PHOTO_RULES.maxStoredBytes) return `That image is still over ${mb(PHOTO_RULES.maxStoredBytes)} after resizing. Try a different one.`;
  return null;
}

/** Content check by magic bytes: the declared MIME type alone is not trusted. */
export function sniffImageType(b: Uint8Array): PhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PHOTO_PATH_RE = new RegExp(`^(${UUID})/(${UUID})\\.(jpg|png|webp)$`);
export const extForType = (t: string) => (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg');

/** Owner folder + random id + fixed extension. The client never chooses a name. */
export const photoPath = (userId: string, photoId: string, type: string) => `${userId}/${photoId}.${extForType(type)}`;
export const isOwnPhotoPath = (userId: string, path: string) => { const m = PHOTO_PATH_RE.exec(path); return !!m && m[1] === userId; };
