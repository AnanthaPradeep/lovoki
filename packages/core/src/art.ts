/**
 * Deterministic placeholder "photography" so the prototype runs offline with no
 * stock-photo licensing or real faces. Seeds < 1000 render a portrait
 * (silhouette, deliberately non-identifiable); seeds >= 1000 render a scene.
 * Output is an SVG string: web uses a data URI, native uses react-native-svg.
 */

const MOODS = [
  { sky: ['#F4C9A8', '#E79C7E'], ground: '#9C5B4E', figure: '#4A2338', sun: '#FBE3C4' }, // dusk
  { sky: ['#CFE0CF', '#9DBFA6'], ground: '#5E7F68', figure: '#26392D', sun: '#F2F0D8' }, // morning green
  { sky: ['#BCD3E6', '#7EA3C4'], ground: '#40627F', figure: '#1F2F45', sun: '#EEF4F8' }, // river
  { sky: ['#D9C2DE', '#9C7BA8'], ground: '#5A3D66', figure: '#2A1830', sun: '#F6E9F2' }, // lilac
  { sky: ['#F1DFC0', '#D6B387'], ground: '#93704A', figure: '#3E2A1A', sun: '#FFF6E6' }, // sand
  { sky: ['#4B2A44', '#2A1527'], ground: '#1A0B16', figure: '#0E060C', sun: '#F0C266' }, // night
];

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export function photoSvg(seed: number): string {
  const r = rng(seed);
  const m = MOODS[seed % MOODS.length]!;
  const id = `g${seed}`;
  const sunX = 80 + r() * 240, sunY = 90 + r() * 120, sunR = 30 + r() * 40;
  const h1 = 300 + r() * 60, h2 = 340 + r() * 60;
  const hills =
    `<path d="M0 ${h1} C 120 ${h1 - 50}, 220 ${h1 + 30}, 400 ${h1 - 20} L400 500 L0 500Z" fill="${m.ground}" opacity="0.55"/>` +
    `<path d="M0 ${h2} C 140 ${h2 + 20}, 260 ${h2 - 60}, 400 ${h2} L400 500 L0 500Z" fill="${m.ground}"/>`;
  let subject: string;
  if (seed < 1000) {
    // Head-and-shoulders bust; shoulders rise to meet the jaw so it never reads as a keyhole.
    const cx = 160 + r() * 80, hair = r(), headY = 250 + r() * 20;
    const sh = 120 + r() * 20;
    subject =
      `<g fill="${m.figure}">` +
      (hair > 0.45 ? `<ellipse cx="${cx}" cy="${headY + 18}" rx="62" ry="82"/>` : `<ellipse cx="${cx}" cy="${headY - 14}" rx="50" ry="46"/>`) +
      `<path d="M${cx - sh} 500 C ${cx - sh} ${headY + 120}, ${cx - 60} ${headY + 92}, ${cx - 26} ${headY + 70} L ${cx + 26} ${headY + 70} C ${cx + 60} ${headY + 92}, ${cx + sh} ${headY + 120}, ${cx + sh} 500Z"/>` +
      `<rect x="${cx - 24}" y="${headY + 20}" width="48" height="64" rx="18"/>` +
      `<ellipse cx="${cx}" cy="${headY}" rx="44" ry="52"/>` +
      `<ellipse cx="${cx - 14}" cy="${headY - 14}" rx="18" ry="24" fill="${m.sun}" opacity="0.12"/></g>`;
  } else {
    const kind = seed % 3;
    if (kind === 0) subject = `<g fill="${m.figure}" opacity="0.9"><rect x="150" y="320" width="100" height="90" rx="14"/><path d="M250 340 q40 10 0 50" stroke="${m.figure}" stroke-width="12" fill="none"/></g>`;
    else if (kind === 1) subject = `<g fill="${m.figure}" opacity="0.85"><path d="M200 420 V250"/><ellipse cx="170" cy="280" rx="22" ry="60" transform="rotate(-25 170 280)"/><ellipse cx="232" cy="300" rx="20" ry="56" transform="rotate(28 232 300)"/><rect x="160" y="400" width="80" height="70" rx="10"/></g>`;
    else subject = `<g fill="${m.figure}" opacity="0.8"><path d="M60 360 L120 250 L180 360Z"/><path d="M150 360 L230 200 L310 360Z"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.sky[0]}"/><stop offset="1" stop-color="${m.sky[1]}"/></linearGradient></defs>` +
    `<rect width="400" height="500" fill="url(#${id})"/>` +
    `<circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${m.sun}" opacity="0.85"/>` +
    hills + subject + `</svg>`;
}

export function photoDataUri(seed: number): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(photoSvg(seed));
}
