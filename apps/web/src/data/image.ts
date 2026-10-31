import { PHOTO_RULES, sniffImageType, validatePhotoInput, validateStoredPhoto } from '@lovoki/core';

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
