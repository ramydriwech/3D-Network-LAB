// Tracé et couleur des câbles : données et calculs purs (pas de Three.js), testés sans navigateur.
//
// Un câble part de la PRISE d'un équipement (point de branchement calculé par deviceLayout.mjs),
// sort perpendiculairement à la façade, descend au sol, le longe, puis remonte jusqu'à la prise
// d'en face : comme un cordon de brassage posé sur une table ou au sol. links.mjs en fait un tube
// souple (courbe passant par ces points) ; les paquets suivent la même courbe.
//
// La gaine prend la couleur du TYPE de câble du catalogue. Le vert, l'orange et le rouge sont
// volontairement évités : ils sont réservés à la charge du lien (lueur animée, linkLoad.mjs).

import { DEFAULT_CABLE, formatSpeed } from '../sim/catalog.mjs';

/** Couleur de gaine par type de câble (src/sim/catalog.mjs, CABLES). La fibre OM3 est turquoise, comme en vrai. */
export const CABLE_COLORS = Object.freeze({
  cat5: '#8d96a3',   // gris
  cat5e: '#d5dae1',  // blanc cassé
  cat6: '#4a8af4',   // bleu
  cat6a: '#7c5cd6',  // violet
  fibre: '#1fc3d6',  // turquoise (« aqua », couleur normalisée de la fibre OM3)
});

/** Nom court de chaque type de câble, pour l'étiquette posée sur le câble. */
const CABLE_SHORT_NAMES = Object.freeze({
  cat5: { fr: 'Cat 5', en: 'Cat 5' },
  cat5e: { fr: 'Cat 5e', en: 'Cat 5e' },
  cat6: { fr: 'Cat 6', en: 'Cat 6' },
  cat6a: { fr: 'Cat 6a', en: 'Cat 6a' },
  fibre: { fr: 'Fibre OM3', en: 'OM3 fibre' },
});

/**
 * Étiquette d'un câble : son type et la vitesse RÉELLE du lien (négociée : la plus petite des deux
 * cartes et du câble), et non la capacité du câble — un Cat 6 entre deux cartes Gigabit marche à
 * 1 Gb/s. Si un élément bride le lien, une 2e ligne dit lequel.
 * @param {{ speed: number, limitedBy: 'a'|'b'|'cable'|null }} link  lien simulé (sim.link(id))
 * @param {{ cable?: string, nameA?: string, nameB?: string, lang?: 'fr'|'en' }} context
 * @returns {{ lines: string[], limited: boolean }}
 */
export function cableTagLines(link, { cable = DEFAULT_CABLE, nameA = '?', nameB = '?', lang = 'fr' } = {}) {
  const names = CABLE_SHORT_NAMES[cable] || CABLE_SHORT_NAMES[DEFAULT_CABLE];
  const lines = [`${names[lang] || names.fr} · ${formatSpeed(link.speed)}`];
  const limited = !!link.limitedBy;
  if (limited) {
    const culprit = link.limitedBy === 'cable' ? (lang === 'en' ? 'the cable' : 'le câble') : (link.limitedBy === 'a' ? nameA : nameB);
    lines.push(lang === 'en' ? `limited by ${culprit}` : `bridé par ${culprit}`);
  }
  return { lines, limited };
}

/** Rayon de la gaine (unités de la scène). */
export const CABLE_RADIUS = 0.018;
/** Hauteur de l'axe d'un câble posé au sol (un peu de marge : la courbe lisse s'arrondit dans les virages). */
export const FLOOR_Y = CABLE_RADIUS + 0.03;

/** Couleur de gaine d'un type de câble ; type inconnu = Cat 6 (le câble par défaut). */
export function cableColor(cableId) {
  return CABLE_COLORS[cableId] || CABLE_COLORS[DEFAULT_CABLE];
}

const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];

/** Écart maximal entre deux points d'un parcours droit (au sol ou dans un chemin de câbles). */
const STRAIGHT_STEP = 0.5;

/**
 * Ajoute des points intermédiaires sur les longs tronçons horizontaux : sans eux, la courbe lisse
 * qui passe par les points (Catmull-Rom) creuserait entre deux points éloignés et passerait sous
 * le sol (ou sous le chemin de câbles).
 */
function straighten(points) {
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1];
    const q = points[i];
    const flat = Math.abs(p[1] - q[1]) < 1e-6;
    const length = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (flat && length > STRAIGHT_STEP) {
      const parts = Math.ceil(length / STRAIGHT_STEP);
      for (let k = 1; k < parts; k += 1) {
        const t = k / parts;
        result.push([p[0] + (q[0] - p[0]) * t, p[1], p[2] + (q[2] - p[2]) * t]);
      }
    }
    result.push(q);
  }
  return result;
}
const distance2D = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);

/**
 * Points de passage d'un câble entre deux extrémités.
 * @param {{ point: number[], out: number[] }} a  prise de départ et direction de sortie (unitaire, horizontale)
 * @param {{ point: number[], out: number[] }} b  prise d'arrivée et sa direction de sortie
 * @returns {number[][]} points [x, y, z] dans l'ordre, du départ à l'arrivée
 */
export function cableRoute(a, b) {
  const span = distance2D(a.point, b.point);
  // Longueur de sortie : assez pour dégager la façade, sans dépasser le tiers du trajet.
  const reach = Math.min(0.32, Math.max(0.08, span / 3));
  const near = (end) => add(end.point, end.out, reach * 0.5);
  const down = (end) => {
    const p = add(end.point, end.out, reach);
    return [p[0], FLOOR_Y, p[2]];
  };
  const points = [a.point, near(a)];
  // Une prise déjà au ras du sol n'a pas besoin de descendre.
  if (a.point[1] > FLOOR_Y + 0.06) points.push(down(a));
  if (b.point[1] > FLOOR_Y + 0.06) points.push(down(b));
  points.push(near(b), b.point);
  // Deux points presque confondus donneraient une boucle : on les fusionne.
  return straighten(points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1], p[2] - points[i - 1][2]) > 0.02));
}

/**
 * Extrémité de secours quand le port n'a pas d'emplacement connu (modèle simplifié, port
 * hors catalogue) : bord de l'équipement, du côté de l'autre extrémité.
 */
export function fallbackEnd(center, other, height = 0.14, radius = 0.45) {
  const dx = other[0] - center[0];
  const dz = other[2] - center[2];
  const length = Math.hypot(dx, dz) || 1;
  const out = [dx / length, 0, dz / length];
  return { point: [center[0] + out[0] * radius, height, center[2] + out[2] * radius], out };
}

// --- Chemins de câbles (laboratoire) ---------------------------------------------------------
//
// Dans la salle du laboratoire, les câbles ne traversent pas l'allée : ils montent dans des
// CHEMINS DE CÂBLES suspendus sous le plafond, comme dans une vraie salle réseau. Le trajet est à
// angle droit : montée au-dessus de la prise, parcours le long de x, puis le long de z, et
// descente jusqu'à l'autre prise. Chaque câble est légèrement décalé dans le chemin (`offset`)
// pour former une nappe. Les segments « sans décalage » servent à dessiner les chemins eux-mêmes.

/** Arrondi pour comparer des coordonnées de chemins de câbles. */
const snap = (value) => Math.round(value * 20) / 20;

/**
 * Trajet d'un câble par les chemins de câbles.
 * @param {{ point: number[], out: number[], rise?: number[] }} a  prise de départ (voir cableRoute) ;
 *   `rise` : point de montée imposé (bord d'une baie : le câble longe la façade puis monte sur le côté)
 * @param {{ point: number[], out: number[], rise?: number[] }} b  prise d'arrivée
 * @param {{ height: number, offset?: number }} tray  hauteur des chemins et décalage du câble dans la nappe
 * @returns {{ points: number[][], segments: Array<[number[], number[]]> }}
 *   points : points de passage du câble ; segments : tronçons horizontaux de chemin ([x, z] → [x, z]), sans décalage
 */
export function trayRoute(a, b, { height, offset = 0 }) {
  const reach = 0.3;
  const riseA = a.rise || add(a.point, a.out, reach);
  const riseB = b.rise || add(b.point, b.out, reach);
  const corner = [riseB[0], height, riseA[2]];
  const h = height;
  // Coude serré au pied de la montée : un point juste avant (dans l'axe d'arrivée) et un juste
  // au-dessus, sinon la courbe lisse ferait une boucle qui pend sous l'équipement.
  const elbow = (from, rise) => {
    const dx = rise[0] - from[0];
    const dz = rise[2] - from[2];
    const length = Math.hypot(dx, dz);
    const back = length > 0.05 ? Math.min(0.12, length / 2) / length : 0;
    return [[rise[0] - dx * back, rise[1], rise[2] - dz * back], rise, [rise[0], rise[1] + 0.3, rise[2]]];
  };
  const nearA = add(a.point, a.out, reach * 0.5);
  const nearB = add(b.point, b.out, reach * 0.5);
  const points = [
    a.point,
    nearA,
    ...elbow(nearA, riseA),
    [riseA[0], h - 0.45, riseA[2]],
    [riseA[0] + offset, h, riseA[2] + offset],
  ];
  // Le long de x (z constant), puis le long de z (x constant) : points avant et après le coin
  // pour que la courbe lisse garde des tronçons droits.
  const alongX = riseB[0] - riseA[0];
  const alongZ = riseB[2] - riseA[2];
  const soften = (span) => Math.sign(span) * Math.min(0.35, Math.abs(span) / 3);
  if (Math.abs(alongX) > 0.1) points.push([corner[0] - soften(alongX) + offset, h, corner[2] + offset]);
  if (Math.abs(alongX) > 0.1 && Math.abs(alongZ) > 0.1) points.push([corner[0] + offset, h, corner[2] + soften(alongZ) + offset]);
  points.push([riseB[0] + offset, h, riseB[2] + offset], [riseB[0], h - 0.45, riseB[2]], ...elbow(nearB, riseB).reverse(), nearB, b.point);
  const clean = straighten(points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1], p[2] - points[i - 1][2]) > 0.02));
  const segments = [];
  if (Math.abs(alongX) > 0.1) segments.push([[riseA[0], riseA[2]], [corner[0], corner[2]]]);
  if (Math.abs(alongZ) > 0.1) segments.push([[corner[0], corner[2]], [riseB[0], riseB[2]]]);
  return { points: clean, segments };
}

/**
 * Chemins de câbles à dessiner : fusionne les tronçons de plusieurs câbles qui se superposent
 * (même ligne, intervalles qui se touchent). Chaque tronçon est parallèle à x ou à z.
 * @param {Array<[number[], number[]]>} segments  tronçons [x, z] → [x, z]
 * @returns {Array<{ axis: 'x'|'z', at: number, from: number, to: number }>}
 *   axis 'x' : chemin le long de x, à z = at, de x = from à x = to (et inversement pour 'z')
 */
export function trayLines(segments) {
  const lines = new Map(); // 'x:z' ou 'z:x' -> intervalles
  for (const [p, q] of segments) {
    const axis = Math.abs(p[0] - q[0]) >= Math.abs(p[1] - q[1]) ? 'x' : 'z';
    const at = snap(axis === 'x' ? p[1] : p[0]);
    const [from, to] = axis === 'x' ? [p[0], q[0]].sort((m, n) => m - n) : [p[1], q[1]].sort((m, n) => m - n);
    const key = `${axis}:${at}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push([from, to]);
  }
  const result = [];
  for (const [key, intervals] of lines) {
    const [axis, at] = [key[0], Number(key.slice(2))];
    intervals.sort((m, n) => m[0] - n[0]);
    let [from, to] = intervals[0];
    for (const [start, end] of intervals.slice(1)) {
      if (start <= to + 0.05) to = Math.max(to, end);
      else { result.push({ axis, at, from, to }); [from, to] = [start, end]; }
    }
    result.push({ axis, at, from, to });
  }
  return result;
}

/**
 * Courbe lisse d'un câble, échantillonnée : Catmull-Rom centripète (le même calcul que
 * THREE.CatmullRomCurve3), puis bornée par le plus bas de ses points de passage. Une courbe lisse
 * s'arrondit dans les coudes et peut dépasser ses points : sans cette borne, un câble qui
 * descend au sol passerait un peu dessous. links.mjs trace le tube le long de ces points.
 * @param {number[][]} points  points de passage (cableRoute ou trayRoute)
 * @returns {number[][]} points rapprochés, du premier au dernier
 */
export function smoothRoute(points, perSegment = 8) {
  const n = points.length;
  if (n < 3) return points.map((p) => [...p]);
  const floor = Math.min(...points.map((p) => p[1]));
  const at = (i) => points[Math.max(0, Math.min(n - 1, i))];
  const gap = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
  const out = [];
  for (let i = 0; i < n - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const d0 = gap(p0, p1);
    const d1 = gap(p1, p2);
    const d2 = gap(p2, p3);
    const coefficients = [0, 1, 2].map((c) => {
      const t1 = ((p1[c] - p0[c]) / d0 - (p2[c] - p0[c]) / (d0 + d1) + (p2[c] - p1[c]) / d1) * d1;
      const t2 = ((p2[c] - p1[c]) / d1 - (p3[c] - p1[c]) / (d1 + d2) + (p3[c] - p2[c]) / d2) * d1;
      return [p1[c], t1, -3 * p1[c] + 3 * p2[c] - 2 * t1 - t2, 2 * p1[c] - 2 * p2[c] + t1 + t2];
    });
    for (let k = i === 0 ? 0 : 1; k <= perSegment; k += 1) {
      const t = k / perSegment;
      const p = coefficients.map(([c0, c1, c2, c3]) => c0 + c1 * t + c2 * t * t + c3 * t * t * t);
      p[1] = Math.max(p[1], floor);
      out.push(p);
    }
  }
  return out;
}
