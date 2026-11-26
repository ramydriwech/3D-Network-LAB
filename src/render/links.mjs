// Câbles : un cordon souple branché dans la prise de chaque équipement.
//
// Le tracé (cableRoute.mjs) sort de la prise, descend au sol et remonte jusqu'à l'autre prise
// (vue classique), ou monte dans les chemins de câbles du plafond (laboratoire, routing 'tray') ;
// le câble est un tube qui suit une courbe lisse passant par ces points, avec un connecteur
// à chaque bout (fiche RJ45, ou LC duplex pour la fibre : cablePlug). La gaine a la couleur du
// type de câble ; la charge du lien est montrée par une lueur animée ajoutée par linkLoad.mjs.
//
// Le groupe rendu porte dans userData : kind 'link', curve (la courbe, du côté « a » au côté
// « b » du scénario, que suivent les paquets), length, tube, jacket (couleur de la gaine),
// traySegments (tronçons de chemin de câbles empruntés, en mode 'tray').

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.mjs';
import { cableRoute, trayRoute, smoothRoute, cableColor, CABLE_RADIUS } from './cableRoute.mjs';

export { CABLE_RADIUS };
/** Hauteur d'une extrémité de secours (port sans emplacement connu). */
export const CABLE_HEIGHT = 0.14;
/** Longueur du connecteur hors de la prise, jusqu'au milieu du manchon, où commence le cordon. */
export const PLUG_REACH = 0.1;

// ---------------------------------------------------------------- connecteurs
//
// Repère d'un connecteur : la pointe (qui entre dans la prise) vers -z, le câble vers +z ;
// l'origine est sur la façade de l'équipement. Chaque connecteur est fait de trois maillages
// (géométries fusionnées, partagées par tous les câbles) : le corps, l'intérieur (fils,
// contacts, embouts : couleurs par sommet) et le manchon, à la couleur de la gaine.

const plugParts = new Map();
const plugMaterials = new Map();

function sharedMaterial(key, make) {
  if (!plugMaterials.has(key)) plugMaterials.set(key, make());
  return plugMaterials.get(key);
}

/** Corps transparent d'une fiche RJ45 (on voit les fils au travers). */
const clearMaterial = () => sharedMaterial('clear', () => new THREE.MeshStandardMaterial({
  color: 0xeef3f8, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false,
}));
/** Intérieur : fils, contacts dorés, embouts céramique (couleur par sommet). */
const insideMaterial = () => sharedMaterial('inside', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }));

/** Manchon, un peu plus clair que la gaine ; boîtier du connecteur fibre (light), nettement plus clair. */
function plugMaterial(color, light = false) {
  return sharedMaterial(color + (light ? ':light' : ''), () => {
    const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), light ? 0.5 : 0.15);
    return new THREE.MeshStandardMaterial({ color: tint, roughness: light ? 0.35 : 0.45, metalness: 0 });
  });
}

/** Pavé centré en `at`, teint `color` (couleurs par sommet) ; `tilt` : rotation autour de x. */
function part(size, at, color = 0xffffff, tilt = 0) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  return finish(geometry, at, color, tilt);
}
/** Cylindre d'axe z (rayon côté pointe r0, côté câble r1). */
function rod(r0, r1, length, at, color = 0xffffff, sides = 12) {
  const geometry = new THREE.CylinderGeometry(r0, r1, length, sides);
  geometry.rotateX(-Math.PI / 2); // l'axe y du cylindre devient z, le haut (r0) vers -z
  return finish(geometry, at, color, 0);
}
function finish(geometry, at, color, tilt) {
  if (tilt) geometry.rotateX(tilt);
  geometry.translate(at[0], at[1], at[2]);
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
function merged(list) {
  const geometry = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return geometry;
}

// Ordre T568B des huit fils : blanc-orange, orange, blanc-vert, bleu, blanc-bleu, vert, blanc-marron, marron.
const T568B = [0xf6c79a, 0xf28c28, 0xb9e3b0, 0x2f6fd6, 0xb4cdf2, 0x2e9e4f, 0xd8c0a8, 0x7a4a26];
const GOLD = 0xe0b13a;

/**
 * Fiche RJ45 (8P8C) : corps transparent 0,054 × 0,038 × 0,095 (la pointe s'enfonce dans la
 * prise), languette de verrouillage sur le dessus, huit contacts dorés à la pointe, les huit
 * fils colorés visibles au travers, barre de sertissage, manchon anti-accroche.
 */
function rj45Parts() {
  // Le corps dépasse de la prise d'environ 0,045 : on le voit bien, fils compris.
  const shell = merged([
    part([0.054, 0.038, 0.095], [0, 0, 0.0125]),
    // Languette : part de la pointe et s'écarte du corps en allant vers le câble.
    part([0.022, 0.005, 0.07], [0, 0.023, 0.012], 0xffffff, -0.12),
  ]);
  const inside = [];
  for (let i = 0; i < 8; i += 1) {
    const x = (i - 3.5) * 0.0058;
    inside.push(part([0.0042, 0.006, 0.07], [x, -0.002, 0.024], T568B[i])); // fil
    inside.push(part([0.0028, 0.012, 0.016], [x, -0.012, -0.025], GOLD)); // contact, côté opposé à la languette
  }
  inside.push(part([0.048, 0.008, 0.008], [0, 0.008, 0.05], 0x9aa3ad)); // barre de sertissage
  const boot = merged([
    part([0.05, 0.034, 0.024], [0, -0.002, 0.072]),
    rod(0.022, 0.02, 0.045, [0, -0.002, 0.105], 0xffffff, 14),
  ]);
  return { shell, inside: merged(inside), boot, clear: true };
}

/**
 * Connecteur fibre LC duplex : deux petits boîtiers carrés côte à côte (émission et
 * réception), chacun avec sa languette et son embout céramique blanc, réunis par une agrafe ;
 * deux manchons qui se rejoignent dans le câble.
 */
function lcParts() {
  const shell = [];
  const inside = [];
  const boot = [];
  for (const side of [-1, 1]) {
    const x = side * 0.0155;
    shell.push(part([0.024, 0.024, 0.07], [x, 0, -0.01]));
    shell.push(part([0.012, 0.004, 0.04], [x, 0.016, 0.004], 0xffffff, -0.18)); // languette
    inside.push(rod(0.0055, 0.0055, 0.026, [x, 0, -0.056], 0xf4f1ea)); // embout céramique
    const sleeve = rod(0.011, 0.008, 0.05, [0, 0, 0], 0xffffff, 10);
    sleeve.rotateY(-side * 0.22);
    sleeve.translate(x * 0.55, 0, 0.05);
    boot.push(sleeve);
  }
  inside.push(part([0.062, 0.008, 0.026], [0, 0.021, 0.012], 0xf2f2ee)); // agrafe duplex
  boot.push(rod(0.013, 0.012, 0.03, [0, 0, 0.085], 0xffffff, 12));
  return { shell: merged(shell), inside: merged(inside), boot: merged(boot), clear: false };
}

function partsFor(fibre) {
  const key = fibre ? 'lc' : 'rj45';
  if (!plugParts.has(key)) plugParts.set(key, fibre ? lcParts() : rj45Parts());
  return plugParts.get(key);
}

/**
 * Connecteur d'un câble (fiche RJ45, ou LC duplex pour la fibre), dans le repère décrit plus
 * haut. Utilisé aux deux bouts de chaque câble et sur les rouleaux de l'étagère du labo.
 * @param {string} color couleur de la gaine
 * @param {boolean} fibre connecteur LC duplex au lieu d'une fiche RJ45
 */
export function cablePlug(color, fibre = false) {
  const parts = partsFor(fibre);
  const group = new THREE.Group();
  const shell = new THREE.Mesh(parts.shell, parts.clear ? clearMaterial() : plugMaterial(color, true));
  const inside = new THREE.Mesh(parts.inside, insideMaterial());
  const boot = new THREE.Mesh(parts.boot, plugMaterial(color));
  if (parts.clear) shell.renderOrder = 1; // après les fils, qu'on voit au travers
  for (const mesh of [inside, boot]) mesh.castShadow = true;
  group.add(inside, shell, boot);
  group.userData.connector = fibre ? 'lc' : 'rj45';
  return group;
}

/** Câble à fibre optique (connecteurs LC) plutôt qu'en cuivre (fiches RJ45). */
export const isFibre = (cableId) => String(cableId || '').startsWith('fibre');

const vector = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const plain = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);

/**
 * Crée le câble entre deux extrémités { point, out } (coordonnées de la topologie ; tableaux
 * [x, y, z] ou Vector3), avec la couleur du type de câble `cableId` (cat5, cat6, fibre…).
 */
export function createLink(endA, endB, cableId, routing) {
  const color = cableColor(cableId);
  const group = new THREE.Group();
  // Chaque câble a son propre matériau : il vire au rouge sombre si le lien est coupé (linkLoad.mjs).
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 }));
  tube.castShadow = true;
  group.add(tube);
  const plugs = [0, 1].map(() => {
    const plug = cablePlug(color, isFibre(cableId));
    group.add(plug);
    return plug;
  });
  group.userData = { kind: 'link', tube, plugs, cable: cableId, jacket: color };
  placeLink(group, endA, endB, routing);
  return group;
}

/**
 * (Re)trace un câble existant entre deux nouvelles extrémités (déplacement dans l'éditeur).
 * routing : { mode: 'floor' } (par défaut, au sol) ou { mode: 'tray', height, offset } (chemins de câbles) ;
 * routing.scale (1 par défaut) grossit le câble et ses connecteurs (mode classique : 1,5).
 */
export function placeLink(group, endA, endB, routing = { mode: 'floor' }) {
  const a = { point: plain(endA.point), out: plain(endA.out), rise: endA.rise ? plain(endA.rise) : undefined };
  const b = { point: plain(endB.point), out: plain(endB.out), rise: endB.rise ? plain(endB.rise) : undefined };
  const scale = routing && routing.scale > 0 ? routing.scale : 1;
  // Le cordon part du manchon du connecteur, pas du fond de la prise : il ne remplit pas le
  // corps transparent de la fiche (on y voit les fils).
  const [ra, rb] = [a, b].map((end) => {
    const length = Math.hypot(end.out[0], end.out[1], end.out[2]) || 1;
    const point = end.point.map((v, k) => v + (end.out[k] / length) * PLUG_REACH * scale);
    return { ...end, point };
  });
  let points = null;
  if (routing && routing.mode === 'tray') {
    const route = trayRoute(ra, rb, { height: routing.height, offset: routing.offset || 0 });
    points = route.points;
    group.userData.traySegments = route.segments;
  } else {
    points = cableRoute(ra, rb);
    group.userData.traySegments = [];
  }
  // Courbe lisse bornée (smoothRoute) : le câble ne passe jamais sous le sol ni sous un chemin de câbles.
  const curve = new THREE.CatmullRomCurve3(smoothRoute(points).map(vector), false, 'centripetal');
  const length = curve.getLength();
  const segments = Math.min(120, Math.max(24, Math.round(length * 14)));
  const { tube, plugs } = group.userData;
  const old = tube.geometry;
  tube.geometry = new THREE.TubeGeometry(curve, segments, CABLE_RADIUS * scale, 7, false);
  if (old) old.dispose();
  // Connecteurs : enfoncés dans la prise, alignés sur la direction de sortie.
  [a, b].forEach((end, i) => {
    plugs[i].position.set(end.point[0], end.point[1], end.point[2]);
    plugs[i].rotation.set(0, Math.atan2(end.out[0], end.out[2]), 0);
    plugs[i].scale.setScalar(scale);
  });
  group.userData.thickness = scale; // épaisseur relative (lueur de passage, linkLoad.mjs)
  group.userData.curve = curve;
  group.userData.length = length;
  if (group.userData.onPlace) group.userData.onPlace(group);
  return group;
}
