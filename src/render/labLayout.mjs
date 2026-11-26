// Plan de la salle du laboratoire : où sont les meubles, et sur quel meuble est installé chaque
// équipement. Module pur (sans Three.js), testé dans tests/labLayout.test.mjs.
//
// Le plan est rangé dans le scénario lui-même, champ `lab` (il voyage avec le brouillon de
// l'éditeur, l'export JSON et l'enregistrement) :
//
//   lab: {
//     room: { minX, maxX, minZ, maxZ },                 // murs de la salle (m)
//     furniture: [{ id, kind, x, z, rot }],             // meubles : position au sol (m), rotation (°, multiple de 90)
//     mounts: { [deviceId]: { on: furnitureId, slot } }, // équipement → meuble et emplacement
//   }
//
// Un scénario sans plan (tous les scénarios fournis) reçoit un plan automatique : un poste de
// travail sous chaque PC, une baie pour chaque switch, routeur, pare-feu ou serveur (un petit
// boîtier de bureau y est posé sur une tablette), à l'endroit où l'équipement se trouve dans la
// topologie. Les tables servent à qui construit sa salle à la main.
//
// Repère : x vers la droite, z vers l'entrée (la porte est sur le mur +z), y vers le haut. Un
// meuble de rotation 0 a sa façade tournée vers +z.

import { deviceLayout } from './deviceLayout.mjs';

/** Échelle de la topologie dans la salle : 1 unité de la scène = 50 cm (voir lab.mjs). */
export const LAB_SCALE = 0.5;
/** Hauteur des plateaux des bureaux et des tables (m). */
export const DESK_TOP = 0.8;
/** Hauteur d'un emplacement « U » de baie dans la salle (m) : un équipement 1U y fait 10 cm. */
export const RACK_UNIT = 0.1;
/** Salle vide : dimensions par défaut (m), porte au milieu du mur +z. */
export const EMPTY_ROOM = Object.freeze({ minX: -6, maxX: 6, minZ: -4.5, maxZ: 4.5 });
const MARGIN = 2.6; // espace entre les équipements et les murs (plan automatique)
const WALL_GAP = 0.25; // un meuble ne touche pas le mur
const SHELF_ZONE = 1.0; // bande réservée aux étagères le long du mur +x
const DOOR_ZONE = 1.4; // dégagement devant la porte (mur +z)

/**
 * Catalogue du mobilier. `size` : [largeur, profondeur] au sol (m), à rotation 0.
 *   rack  : `units` emplacements de RACK_UNIT, le premier à `firstU` m du sol ;
 *   desk  : un poste de travail (PC) ;
 *   table : `spots` places pour des boîtiers de bureau (petit switch, petit pare-feu).
 */
export const FURNITURE = Object.freeze({
  rack12: { kind: 'rack', units: 12, firstU: 0.45, height: 2.0, size: [1.24, 0.8], name: { fr: 'Baie 19 pouces 12U', en: '19-inch rack 12U' },
    description: { fr: 'Armoire de brassage : 12 emplacements U pour switchs, routeurs, pare-feu et serveurs de baie, avec onduleur, passe-câbles, panneau de brassage et ventilation.', en: 'Network cabinet: 12 U slots for rack switches, routers, firewalls and servers, with UPS, cable manager, patch panel and fans.' } },
  rack6: { kind: 'rack', units: 6, firstU: 0.15, height: 1.0, size: [1.24, 0.8], name: { fr: 'Baie basse 6U', en: 'Low rack 6U' },
    description: { fr: 'Petite baie à hauteur de table : 6 emplacements U, passe-câbles et panneau de brassage.', en: 'Small table-height rack: 6 U slots, cable manager and patch panel.' } },
  desk: { kind: 'desk', spots: 1, size: [1.4, 1.5], name: { fr: 'Poste de travail (bureau et fauteuil)', en: 'Workstation (desk and chair)' },
    description: { fr: 'Bureau avec son fauteuil : on y pose un PC (écran, tour, clavier).', en: 'Desk with its chair: a PC (screen, tower, keyboard) goes on it.' } },
  table: { kind: 'table', spots: 2, size: [1.6, 0.7], name: { fr: 'Table de laboratoire', en: 'Lab bench' },
    description: { fr: 'Table pour les boîtiers de bureau : deux places (petit switch, petit pare-feu).', en: 'Bench for desktop boxes: two places (small switch, small firewall).' } },
});
/** Profondeur réelle du plateau d'un bureau (le reste de `size` est la place du fauteuil). */
const DESK_DEPTH = 0.75;

/**
 * Sur quels meubles peut aller un modèle (le premier est le meuble habituel) :
 * forme « workstation » (PC) → bureau ; 1U/2U → baie ; boîtier de bureau → baie (sur une tablette) ou table.
 */
export function mountKindsOf(def) {
  const form = deviceLayout(def).form;
  if (form === 'workstation') return ['desk'];
  if (form === 'rack1u' || form === 'rack2u') return ['rack'];
  return ['rack', 'table'];
}
/** Meuble habituel d'un modèle (premier de mountKindsOf). */
export function mountKindOf(def) {
  return mountKindsOf(def)[0];
}
/** Boîtier de bureau : dans une baie, il est posé sur une tablette. */
export function needsTray(def) {
  return deviceLayout(def).form === 'desktop';
}
/** Nombre d'emplacements U occupés dans une baie. */
export function unitsOf(def) {
  return Math.max(1, Math.round((deviceLayout(def).height * LAB_SCALE) / RACK_UNIT));
}

// ------------------------------------------------------------------ géométrie au sol

const quarter = (rot) => ((Math.round((Number(rot) || 0) / 90) % 4) + 4) % 4;
/** Empreinte au sol d'un meuble : { minX, maxX, minZ, maxZ } (rotation par quarts de tour). */
export function footprint(item) {
  const spec = FURNITURE[item.kind];
  const [w, d] = spec.size;
  const turned = quarter(item.rot) % 2 === 1;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  // Le poste de travail déborde vers l'avant (fauteuil) : son plateau est au centre de `size`.
  return { minX: item.x - hw, maxX: item.x + hw, minZ: item.z - hd, maxZ: item.z + hd };
}
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Point local (repère du meuble, façade vers +z) → salle. */
export function toRoomPoint(item, local) {
  const angle = (quarter(item.rot) * Math.PI) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [item.x + local[0] * cos + local[2] * sin, local[1], item.z - local[0] * sin + local[2] * cos];
}
/** Point de la salle → repère du meuble. */
export function toLocalPoint(item, point) {
  const angle = (quarter(item.rot) * Math.PI) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - item.x;
  const dz = point[2] - item.z;
  return [dx * cos - dz * sin, point[1], dx * sin + dz * cos];
}

/** Zones interdites aux meubles : bande des étagères (mur +x), dégagement de la porte (mur +z). */
export function reservedZones(room) {
  const cx = (room.minX + room.maxX) / 2;
  return [
    { minX: room.maxX - SHELF_ZONE, maxX: room.maxX, minZ: room.minZ, maxZ: room.maxZ },
    { minX: cx - 0.9, maxX: cx + 0.9, minZ: room.maxZ - DOOR_ZONE, maxZ: room.maxZ },
  ];
}

/**
 * Un meuble peut-il être posé là ? Dans la salle, loin des murs, hors des zones réservées et
 * sans chevaucher un autre meuble (sauf `ignoreId`, le meuble que l'on déplace).
 * @returns {{ ok: boolean, reason?: 'wall'|'reserved'|'furniture' }}
 */
export function canPlaceFurniture(layout, item, ignoreId = null) {
  const box = footprint(item);
  const room = layout.room;
  if (box.minX < room.minX + WALL_GAP || box.maxX > room.maxX - WALL_GAP || box.minZ < room.minZ + WALL_GAP || box.maxZ > room.maxZ - WALL_GAP) return { ok: false, reason: 'wall' };
  if (reservedZones(room).some((zone) => overlap(box, zone))) return { ok: false, reason: 'reserved' };
  for (const other of layout.furniture) {
    if (other.id === ignoreId) continue;
    if (overlap(box, footprint(other))) return { ok: false, reason: 'furniture' };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ emplacements

/** Équipements installés sur un meuble : [{ deviceId, slot }]. */
export function contentsOf(layout, furnitureId) {
  return Object.entries(layout.mounts).filter(([, m]) => m.on === furnitureId).map(([deviceId, m]) => ({ deviceId, slot: m.slot }));
}

/**
 * Peut-on installer l'équipement `def` sur le meuble `furnitureId`, à l'emplacement `slot`
 * (baie : premier U occupé, compté de 1 en partant du bas ; bureau : 0 ; table : 0 ou 1) ?
 * `devices` : définitions des équipements du scénario (pour la taille de ceux déjà installés).
 * @returns {{ ok: boolean, reason?: 'kind'|'range'|'taken' }}
 */
export function canMount(layout, devices, def, furnitureId, slot) {
  const item = layout.furniture.find((f) => f.id === furnitureId);
  if (!item) return { ok: false, reason: 'range' };
  const spec = FURNITURE[item.kind];
  if (!mountKindsOf(def).includes(spec.kind)) return { ok: false, reason: 'kind' };
  const others = contentsOf(layout, furnitureId).filter((c) => c.deviceId !== def.id);
  if (spec.kind === 'rack') {
    const units = unitsOf(def);
    if (!Number.isInteger(slot) || slot < 1 || slot + units - 1 > spec.units) return { ok: false, reason: 'range' };
    for (const other of others) {
      const otherDef = devices.find((d) => d.id === other.deviceId);
      const otherUnits = otherDef ? unitsOf(otherDef) : 1;
      if (slot <= other.slot + otherUnits - 1 && other.slot <= slot + units - 1) return { ok: false, reason: 'taken' };
    }
    return { ok: true };
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= spec.spots) return { ok: false, reason: 'range' };
  if (others.some((other) => other.slot === slot)) return { ok: false, reason: 'taken' };
  return { ok: true };
}

/** Premier emplacement libre pour `def` sur ce meuble (ou null). */
export function firstFreeSlot(layout, devices, def, furnitureId) {
  const item = layout.furniture.find((f) => f.id === furnitureId);
  if (!item) return null;
  const spec = FURNITURE[item.kind];
  const slots = spec.kind === 'rack' ? Array.from({ length: spec.units }, (u, i) => i + 1) : Array.from({ length: spec.spots }, (u, i) => i);
  return slots.find((slot) => canMount(layout, devices, def, furnitureId, slot).ok) ?? null;
}

/**
 * Emplacement visé sur un meuble, d'après un point de la salle (là où le regard touche le meuble).
 * Baie : l'U sous le point (pour un 2U, celui du bas) ; table : la moitié gauche ou droite.
 */
export function slotAt(layout, devices, def, furnitureId, point) {
  const item = layout.furniture.find((f) => f.id === furnitureId);
  if (!item) return null;
  const spec = FURNITURE[item.kind];
  if (spec.kind === 'desk') return 0;
  const local = toLocalPoint(item, point);
  if (spec.kind === 'table') return local[0] < 0 ? 0 : 1;
  const units = def ? unitsOf(def) : 1;
  const u = Math.floor((point[1] - spec.firstU) / RACK_UNIT) + 1;
  return Math.max(1, Math.min(spec.units - units + 1, u));
}

/**
 * Position et orientation d'un équipement installé, dans la salle : { point: [x, y, z], rot }
 * (point : centre du bas de l'équipement ; rot en degrés). null s'il n'est pas installé.
 */
export function mountPose(layout, def) {
  const mount = layout.mounts[def.id];
  const item = mount && layout.furniture.find((f) => f.id === mount.on);
  if (!item) return null;
  const spec = FURNITURE[item.kind];
  const dims = deviceLayout(def);
  let local;
  if (spec.kind === 'rack') {
    // Façade de l'équipement au ras de la façade de la baie.
    const front = spec.size[1] / 2 - 0.06;
    const tray = needsTray(def) ? 0.012 : 0; // posé sur la tablette
    local = [0, spec.firstU + (mount.slot - 1) * RACK_UNIT + tray, front - (dims.depth * LAB_SCALE) / 2];
  } else if (spec.kind === 'desk') {
    local = [0, DESK_TOP, -spec.size[1] / 2 + DESK_DEPTH / 2];
  } else {
    local = [(mount.slot === 0 ? -1 : 1) * spec.size[0] * 0.25, DESK_TOP, 0];
  }
  return { point: toRoomPoint(item, local), rot: quarter(item.rot) * 90 };
}

// ------------------------------------------------------------------ plan d'un scénario

/** Salle qui contient tous les équipements, avec de la place autour (comme avant le plan). */
function roomAround(devices) {
  let minX = -3; let maxX = 3; let minZ = -3; let maxZ = 3;
  for (const def of devices) {
    minX = Math.min(minX, def.position[0] * LAB_SCALE); maxX = Math.max(maxX, def.position[0] * LAB_SCALE);
    minZ = Math.min(minZ, def.position[2] * LAB_SCALE); maxZ = Math.max(maxZ, def.position[2] * LAB_SCALE);
  }
  return { minX: minX - MARGIN, maxX: maxX + MARGIN + 1.2, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN + 1.2 };
}

/**
 * Plan automatique : chaque équipement sur son propre meuble, là où il est dans la topologie
 * (un équipement de baie à hauteur de travail, comme avant). Les meubles qui se chevauchent sont
 * décalés vers l'arrière de la salle.
 */
export function autoLayout(scenario) {
  const devices = (scenario && scenario.devices) || [];
  const layout = { room: devices.length ? roomAround(devices) : { ...EMPTY_ROOM }, furniture: [], mounts: {} };
  let n = 0;
  for (const def of devices) {
    const kind = mountKindOf(def); // un switch, routeur, pare-feu ou serveur : toujours en baie
    const furnitureKind = kind === 'rack' ? 'rack12' : kind;
    const item = { id: `m${++n}`, kind: furnitureKind, x: round(def.position[0] * LAB_SCALE), z: round(def.position[2] * LAB_SCALE), rot: 0 };
    for (let tries = 0; tries < 12 && !canPlaceFurniture(layout, item).ok; tries += 1) item.z = round(item.z - 0.5);
    layout.furniture.push(item);
    // Baie : l'équipement à environ 80 cm du sol, comme sur une paillasse.
    const slot = kind === 'rack' ? Math.max(1, Math.round((DESK_TOP - FURNITURE.rack12.firstU) / RACK_UNIT)) : 0;
    layout.mounts[def.id] = { on: item.id, slot };
  }
  return layout;
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * Plan d'un scénario : le sien (complété si un équipement n'est installé nulle part : il reçoit
 * un meuble à lui, près de sa place dans la topologie), sinon le plan automatique.
 */
export function layoutOf(scenario) {
  const lab = scenario && scenario.lab;
  if (!lab || !Array.isArray(lab.furniture) || !lab.room) return autoLayout(scenario);
  const layout = { room: { ...lab.room }, furniture: lab.furniture.filter((f) => FURNITURE[f.kind]).map((f) => ({ ...f })), mounts: {} };
  const devices = (scenario && scenario.devices) || [];
  for (const def of devices) {
    const mount = lab.mounts && lab.mounts[def.id];
    if (mount && layout.furniture.some((f) => f.id === mount.on)) layout.mounts[def.id] = { ...mount };
  }
  for (const def of devices) {
    if (layout.mounts[def.id]) continue;
    const kinds = mountKindsOf(def);
    const kind = kinds[0];
    // D'abord une place libre sur un meuble existant qui lui convient…
    const existing = layout.furniture.find((f) => kinds.includes(FURNITURE[f.kind].kind) && firstFreeSlot(layout, devices, def, f.id) !== null);
    if (existing) { layout.mounts[def.id] = { on: existing.id, slot: firstFreeSlot(layout, devices, def, existing.id) }; continue; }
    // …sinon un meuble à lui.
    const item = { id: nextFurnitureId(layout), kind: kind === 'rack' ? 'rack12' : kind, x: round(def.position[0] * LAB_SCALE), z: round(def.position[2] * LAB_SCALE), rot: 0 };
    for (let tries = 0; tries < 20 && !canPlaceFurniture(layout, item).ok; tries += 1) item.z = round(item.z - 0.5);
    layout.furniture.push(item);
    layout.mounts[def.id] = { on: item.id, slot: firstFreeSlot(layout, devices, def, item.id) ?? (kind === 'rack' ? 1 : 0) };
  }
  return layout;
}

export function nextFurnitureId(layout) {
  let n = 1;
  const taken = new Set(layout.furniture.map((f) => f.id));
  while (taken.has(`m${n}`)) n += 1;
  return `m${n}`;
}

// ------------------------------------------------------------------ opérations (sur le brouillon)
//
// Chacune prend un scénario (brouillon de l'éditeur) et en retourne un nouveau, avec son plan
// à jour dans `lab`. Elles lèvent LayoutError avec un message en français et en anglais.

export class LayoutError extends Error {
  constructor(fr, en) { super(fr); this.text = { fr, en }; }
}
const withLayout = (draft) => ({ ...draft, lab: layoutOf(draft) });
/**
 * Le brouillon avec son plan écrit (le plan automatique devient le plan du réseau). À faire avant
 * d'ajouter un équipement que l'on va installer soi-même : sinon le plan automatique lui donnerait
 * son propre meuble, qui resterait vide.
 */
export const ensureLayout = withLayout;

/** Ajoute un meuble : { kind, x, z, rot }. Retourne { draft, id }. */
export function addFurniture(draft, kind, x, z, rot = 0) {
  if (!FURNITURE[kind]) throw new LayoutError(`Meuble inconnu : ${kind}.`, `Unknown furniture: ${kind}.`);
  const next = withLayout(draft);
  const item = { id: nextFurnitureId(next.lab), kind, x: round(x), z: round(z), rot: quarter(rot) * 90 };
  if (!canPlaceFurniture(next.lab, item).ok) throw new LayoutError('Pas assez de place ici pour ce meuble.', 'Not enough room here for this furniture.');
  next.lab = { ...next.lab, furniture: [...next.lab.furniture, item] };
  return { draft: next, id: item.id };
}

/** Déplace (et tourne) un meuble ; ce qu'il porte le suit. */
export function moveFurniture(draft, id, x, z, rot) {
  const next = withLayout(draft);
  const item = next.lab.furniture.find((f) => f.id === id);
  if (!item) throw new LayoutError('Meuble introuvable.', 'Furniture not found.');
  const moved = { ...item, x: round(x), z: round(z), rot: quarter(rot ?? item.rot) * 90 };
  if (!canPlaceFurniture(next.lab, moved, id).ok) throw new LayoutError('Pas assez de place ici pour ce meuble.', 'Not enough room here for this furniture.');
  next.lab = { ...next.lab, furniture: next.lab.furniture.map((f) => (f.id === id ? moved : f)) };
  return next;
}

/** Retire un meuble vide (un meuble qui porte encore un équipement est refusé). */
export function removeFurniture(draft, id) {
  const next = withLayout(draft);
  if (contentsOf(next.lab, id).length) throw new LayoutError('Retirez d\'abord les équipements installés sur ce meuble.', 'First remove the devices installed on this furniture.');
  next.lab = { ...next.lab, furniture: next.lab.furniture.filter((f) => f.id !== id) };
  return next;
}

/** Installe (ou déplace) l'équipement `deviceId` sur un meuble, à un emplacement. */
export function mountDevice(draft, deviceId, furnitureId, slot) {
  // L'équipement est inscrit à sa nouvelle place AVANT de compléter le plan : il n'en reçoit pas
  // une autre au passage (un meuble à lui, qui resterait vide).
  const base = draft.lab && Array.isArray(draft.lab.furniture)
    ? { ...draft, lab: { ...draft.lab, mounts: { ...(draft.lab.mounts || {}), [deviceId]: { on: furnitureId, slot } } } }
    : draft;
  const next = withLayout(base);
  const def = next.devices.find((d) => d.id === deviceId);
  if (!def) throw new LayoutError('Équipement introuvable.', 'Device not found.');
  const check = canMount(next.lab, next.devices, def, furnitureId, slot);
  if (!check.ok) {
    const item = next.lab.furniture.find((f) => f.id === furnitureId);
    const names = { rack: ['une baie', 'a rack'], desk: ['un bureau', 'a desk'], table: ['une table', 'a bench'] };
    const kinds = mountKindsOf(def);
    const fr = kinds.map((k) => names[k][0]).join(' ou ');
    const en = kinds.map((k) => names[k][1]).join(' or ');
    if (check.reason === 'kind') throw new LayoutError(`${def.name} s'installe dans ${fr}${item ? '' : ''}.`, `${def.name} goes on ${en}.`);
    throw new LayoutError('Cet emplacement est déjà occupé.', 'This place is already taken.');
  }
  next.lab = { ...next.lab, mounts: { ...next.lab.mounts, [deviceId]: { on: furnitureId, slot } } };
  return next;
}
