// Environnement lumineux de la scène : une image panoramique (équirectangulaire) calculée
// ici, sans fichier à télécharger. Three.js s'en sert pour l'éclairage indirect et les
// reflets : c'est ce qui donne au métal et au plastique un aspect crédible.
//
// Les valeurs sont en lumière LINÉAIRE et peuvent dépasser 1 (image « HDR ») : une dalle
// lumineuse vaut plusieurs fois un mur, comme dans la réalité. scene.mjs les range dans une
// texture en demi-flottants.
//
// Ce fichier ne dépend pas de Three.js : il se teste sans navigateur.
//
//   - 'studio' : vue classique. Ciel gris doux, deux boîtes à lumière (principale et
//                d'appoint) et un liseré lumineux à l'horizon pour détacher les contours ;
//   - 'lab'    : la salle du laboratoire. Plafond clair percé de dalles LED, murs gris
//                clair avec leur bandeau bleu, sol gris.
//
// Convention : la ligne 0 est en BAS (vers le sol), comme une texture de données Three.js ;
// la colonne 0 est l'azimut 0.

export const ENVIRONMENT_KINDS = Object.freeze(['studio', 'lab']);

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const DEG = Math.PI / 180;

/** Écart d'angle signé, ramené dans [-π, π]. */
function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Boîte à lumière rectangulaire aux bords adoucis, centrée en (azimut, élévation). */
function softbox(azimuth, elevation, box) {
  const dx = Math.abs(angleDelta(azimuth, box.azimuth * DEG)) * Math.cos(elevation);
  const dy = Math.abs(elevation - box.elevation * DEG);
  const w = (box.width / 2) * DEG;
  const h = (box.height / 2) * DEG;
  const soft = 4 * DEG;
  return (1 - smooth(w - soft, w + soft, dx)) * (1 - smooth(h - soft, h + soft, dy));
}

const STUDIO_BOXES = [
  { azimuth: 40, elevation: 48, width: 46, height: 26, color: [1.0, 0.97, 0.92], power: 9 }, // principale
  { azimuth: 215, elevation: 32, width: 40, height: 22, color: [0.85, 0.92, 1.0], power: 3 }, // appoint
  { azimuth: 125, elevation: 14, width: 120, height: 6, color: [0.9, 0.95, 1.0], power: 2.2 }, // liseré
];

function studio(azimuth, elevation) {
  const zenith = [0.42, 0.45, 0.52];
  const horizon = [0.26, 0.28, 0.32];
  const ground = [0.05, 0.055, 0.065];
  let color = elevation >= 0
    ? mix(horizon, zenith, smooth(0, 70 * DEG, elevation))
    : mix(horizon, ground, smooth(0, 25 * DEG, -elevation));
  for (const box of STUDIO_BOXES) {
    const k = softbox(azimuth, elevation, box) * box.power;
    if (k > 0) color = color.map((v, i) => v + box.color[i] * k);
  }
  return color;
}

function lab(azimuth, elevation) {
  const wall = [0.5, 0.53, 0.57];
  const stripe = [0.03, 0.22, 0.42];
  const floor = [0.3, 0.32, 0.35];
  const ceiling = [0.78, 0.8, 0.83];
  if (elevation < -12 * DEG) return mix(wall, floor, smooth(-12 * DEG, -30 * DEG, elevation));
  if (elevation < 42 * DEG) {
    // Bandeau bleu un peu sous la hauteur des yeux, comme sur les murs de la salle.
    const band = 1 - smooth(1.2 * DEG, 2.4 * DEG, Math.abs(elevation + 8 * DEG));
    return mix(mix(wall, ceiling, smooth(20 * DEG, 42 * DEG, elevation)), stripe, band);
  }
  // Plafond : une grille de dalles LED (8 autour, 3 rangées vers le zénith).
  const u = ((azimuth / (2 * Math.PI)) * 8) % 1;
  const v = ((elevation - 42 * DEG) / (48 * DEG)) * 3 % 1;
  const panel = (1 - smooth(0.32, 0.36, Math.abs(u - 0.5))) * (1 - smooth(0.26, 0.3, Math.abs(v - 0.5)));
  return mix(ceiling, [7.5, 7.4, 7.1], panel);
}

/**
 * Pixels RGBA (Float32Array, lumière linéaire) du panorama `kind`.
 * @param {'studio'|'lab'} kind
 */
export function environmentPixels(kind, width = 256, height = 128) {
  const shade = kind === 'lab' ? lab : studio;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const elevation = ((y + 0.5) / height) * Math.PI - Math.PI / 2; // ligne 0 = vers le bas
    for (let x = 0; x < width; x += 1) {
      const azimuth = ((x + 0.5) / width) * 2 * Math.PI;
      const [r, g, b] = shade(azimuth, elevation);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  return { data, width, height };
}

/**
 * Réglages d'ambiance associés : intensité de l'environnement, des lumières directes et
 * direction de la lumière qui porte les ombres.
 */
export const AMBIENCES = Object.freeze({
  studio: Object.freeze({ environment: 0.7, hemisphere: 0.35, sun: 2.4, sunColor: 0xfff4e6, sunDirection: Object.freeze([0.45, 1, 0.55]) }),
  lab: Object.freeze({ environment: 0.4, hemisphere: 0.1, sun: 1.8, sunColor: 0xfff7ed, sunDirection: Object.freeze([0.2, 1, 0.35]) }),
});
