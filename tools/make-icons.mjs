// Génère les icônes PNG de l'application dans assets/icons/ à partir d'un dessin décrit
// ici (le même que favicon.svg). Aucune dépendance : le PNG est écrit avec zlib.
//
//   node tools/make-icons.mjs      (ou : npm run icons)
//
//   icon-192.png, icon-512.png     icônes de la PWA (manifest.json)
//   icon-maskable-512.png          icône « maskable » : dessin réduit dans la zone sûre
//   icon-180.png                   écran d'accueil iPhone/iPad (apple-touch-icon)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

// Dessin sur une grille de 64 unités, comme favicon.svg.
const BACKGROUND = hex('#0b1220');
const LINES = [[32, 17, 15, 45], [32, 17, 49, 45], [15, 45, 49, 45]];
const LINE = { color: hex('#38bdf8'), width: 3 };
const CIRCLES = [
  { x: 32, y: 17, r: 8, color: hex('#f97316') },
  { x: 15, y: 45, r: 7, color: hex('#3b82f6') },
  { x: 49, y: 45, r: 7, color: hex('#10b981') },
  { x: 32, y: 45, r: 3.5, color: hex('#facc15') },
];

function distanceToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Couleur (ou null = transparent) au point (x, y) de la grille 64×64. */
function sample(x, y, { radius, scale }) {
  // Coins arrondis du fond (radius = 0 pour une icône maskable, pleine).
  const cx = Math.max(radius, Math.min(64 - radius, x));
  const cy = Math.max(radius, Math.min(64 - radius, y));
  if (Math.hypot(x - cx, y - cy) > radius) return null;
  // Le dessin est réduit autour du centre (zone sûre des icônes maskable).
  const u = 32 + (x - 32) / scale;
  const v = 32 + (y - 32) / scale;
  for (let i = CIRCLES.length - 1; i >= 0; i--) {
    const circle = CIRCLES[i];
    if (Math.hypot(u - circle.x, v - circle.y) <= circle.r) return circle.color;
  }
  for (const line of LINES) {
    if (distanceToSegment(u, v, line) <= LINE.width / 2) return LINE.color;
  }
  return BACKGROUND;
}

/** Image RGBA de `size` pixels de côté, lissée par sur-échantillonnage 4×4. */
function draw(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const color = sample(((px + (sx + 0.5) / N) / size) * 64, ((py + (sy + 0.5) / N) / size) * 64, options);
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 1; }
        }
      }
      const offset = (py * size + px) * 4;
      if (a) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** Encode une image RGBA en PNG (8 bits par canal, sans entrelacement). */
export function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // profondeur
  header[9] = 6;  // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filtre 0 en tête de ligne
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const ICONS = [
  { file: 'icon-192.png', size: 192, radius: 14, scale: 1 },
  { file: 'icon-512.png', size: 512, radius: 14, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, scale: 0.72 },
  { file: 'icon-180.png', size: 180, radius: 0, scale: 0.86 },
];

// Exécuté directement (et non importé par un test) ? Comparaison sur le nom du fichier : elle
// reste juste sous Windows, où la casse de la lettre du lecteur peut varier.
if (process.argv[1] && import.meta.url.endsWith('/' + path.basename(process.argv[1]))) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const icon of ICONS) {
    const png = encodePng(icon.size, draw(icon.size, icon));
    fs.writeFileSync(path.join(OUT, icon.file), png);
    console.log(`${icon.file} : ${icon.size}×${icon.size}, ${png.length} octets`);
  }
}
