import { describe, it, expect } from 'vitest';
import { PHOTO_PATH_RE, PHOTO_RULES, isOwnPhotoPath, photoPath, sniffImageType, validatePhotoInput, validateStoredPhoto } from './photos';

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P = '10000000-0000-4000-8000-000000000001';

describe('photo rules (client-side checks; the server re-enforces them)', () => {
  it('accepts only JPG, PNG, WebP', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(validatePhotoInput({ type: t, size: 1000 })).toBeNull();
    for (const t of ['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', 'text/html', 'application/x-msdownload', '']) expect(validatePhotoInput({ type: t, size: 1000 })).toBe('Use a JPG, PNG or WebP image.');
  });
  it('enforces size limits on the input and on what is stored', () => {
    expect(validatePhotoInput({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(validatePhotoInput({ type: 'image/png', size: PHOTO_RULES.maxInputBytes + 1 })).toMatch(/over 15 MB/);
    expect(validatePhotoInput({ type: 'image/png', size: PHOTO_RULES.maxInputBytes })).toBeNull();
    expect(validateStoredPhoto({ type: 'image/jpeg', size: PHOTO_RULES.maxStoredBytes + 1 })).toMatch(/5 MB/);
    expect(validateStoredPhoto({ type: 'image/jpeg', size: PHOTO_RULES.maxStoredBytes })).toBeNull();
    expect(validateStoredPhoto({ type: 'image/gif', size: 10 })).not.toBeNull();
  });
  it('identifies images by content, not by the declared type', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    const text = new TextEncoder().encode('<script>alert(1)</script>');
    expect(sniffImageType(text)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('MZ\u0090\u0000'))).toBeNull(); // an executable renamed to .jpg
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // RIFF WAVE
  });
  it('builds safe storage paths: owner folder, uuid name, fixed extension', () => {
    expect(photoPath(U, P, 'image/jpeg')).toBe(`${U}/${P}.jpg`);
    expect(photoPath(U, P, 'image/png')).toBe(`${U}/${P}.png`);
    expect(PHOTO_PATH_RE.test(photoPath(U, P, 'image/webp'))).toBe(true);
    expect(isOwnPhotoPath(U, `${U}/${P}.jpg`)).toBe(true);
  });
  it('rejects paths that are not exactly owner/uuid.ext', () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    for (const bad of [`${other}/${P}.jpg`, `${U}/evil.php`, `${U}/${P}.exe`, `${U}/${P}.jpg.php`, `${U}/sub/${P}.jpg`, `../${U}/${P}.jpg`, `${U}/../${other}/${P}.jpg`, `${U}/${P}.JPG`, `${U}//${P}.jpg`, '', '/etc/passwd'])
      expect(isOwnPhotoPath(U, bad), bad).toBe(false);
  });
  it('limits the number of photos', () => { expect(PHOTO_RULES.maxCount).toBe(6); });
});
