// Disposition des équipements 3D : à partir de la fiche du catalogue (src/sim/catalog.mjs),
// ce module calcule la forme d'un modèle, ses dimensions et l'emplacement de chaque port et
// de chaque voyant. Il décide aussi de la couleur des voyants selon l'état du port.
//
// Ce fichier ne contient que des données et des calculs (pas de Three.js) : il se teste sans
// navigateur. deviceModels.mjs construit la 3D à partir de ce qu'il rend ; portLeds.mjs allume
// les voyants pendant la simulation.
//
// Repère d'un modèle : origine au sol, au centre ; y vers le haut ; façade vers +z.
// Les dimensions sont en unités de la scène (1 unité = 50 cm dans le laboratoire) : les
// équipements sont environ deux fois plus grands que nature, pour rester lisibles.

import { MODELS, DEFAULT_MODEL, modelIdOf } from '../sim/catalog.mjs';

/** Couleur repère de chaque type (liseré de façade, fond d'écran) : la même que les formes simples. */
export const TYPE_ACCENTS = Object.freeze({
  host: '#3b82f6', server: '#8b5cf6', switch: '#10b981', router: '#f97316', firewall: '#dc2626',
});

/** Marque (fictive) affichée en façade, d'après le système de l'équipement. */
const BRANDS = Object.freeze({ netcore: 'NETCORE', versa: 'VERSA', shield: 'SHIELD' });

/** Couleurs des voyants. « off » : un voyant éteint reste visible (plastique sombre). */
export const LED_COLORS = Object.freeze({ off: '#1c2026', green: '#22e06a', amber: '#ffb020', blue: '#38bdf8' });

/** Formes : boîtier de baie 1U ou 2U, petit boîtier de bureau, poste de travail. */
const FORMS = Object.freeze({
  rack1u: { minWidth: 1.9, height: 0.2, depth: 1.0, ears: true },
  rack2u: { minWidth: 1.9, height: 0.36, depth: 1.1, ears: true },
  desktop: { minWidth: 1.1, height: 0.16, depth: 0.7, ears: false },
  workstation: { minWidth: 2.0, height: 0.8, depth: 1.0, ears: false },
});

/** Forme de chaque modèle du catalogue ; un modèle inconnu prend celle de son type. */
const MODEL_FORMS = Object.freeze({
  'pc-std': 'workstation', 'pc-fe': 'workstation',
  'srv-1g': 'rack2u', 'srv-10g': 'rack2u',
  'sw-8g': 'desktop', 'sw-8f': 'desktop', 'sw-24g': 'rack1u', 'sw-24m': 'rack1u', 'sw-24v': 'rack1u',
  'rt-2g': 'rack1u', 'rt-4g': 'rack1u', 'rt-2v': 'rack1u',
  'fw-3g': 'desktop', 'fw-8g': 'rack1u',
});
const TYPE_FORMS = Object.freeze({ host: 'workstation', server: 'rack2u', switch: 'desktop', router: 'rack1u', firewall: 'desktop' });

/** Anciens modèles en plastique beige ; les autres sont en métal sombre. */
const BEIGE = new Set(['pc-fe', 'sw-8f']);

// Gabarit des prises en façade.
const JACK = Object.freeze({ width: 0.074, height: 0.06, pitch: 0.088, groupGap: 0.03, group: 6 });
const SFP = Object.freeze({ width: 0.1, height: 0.045, pitch: 0.12 });
const LEFT_ZONE = 0.34; // marque, modèle et voyants d'état, à gauche de la façade
const RIGHT_MARGIN = 0.1;

/** Ports du modèle, avec leur nature : RJ45 (cuivre) ou cage SFP (10 Gb/s). */
function portsOf(model) {
  const list = [];
  for (const group of model.ports) {
    for (let i = 0; i < group.count; i += 1) {
      list.push({ name: group.prefix + (group.from + i), speed: group.speed, kind: group.speed >= 10000 && group.prefix === 'u' ? 'sfp' : 'rj45' });
    }
  }
  return list;
}

/** Deux voyants par prise RJ45 : lien (à gauche) et activité (à droite), dans les coins de la prise. */
function jackLeds(x, y, flip, z) {
  const dy = (JACK.height / 2 - 0.009) * (flip ? -1 : 1);
  return [
    { role: 'link', x: x - JACK.width / 2 + 0.012, y: y + dy, z },
    { role: 'act', x: x + JACK.width / 2 - 0.012, y: y + dy, z },
  ];
}

/** Façade d'un boîtier (switch, routeur, pare-feu) : prises sur une ou deux rangées, SFP à droite. */
function frontPanel(model, form, type) {
  const all = portsOf(model);
  const rj45 = all.filter((port) => port.kind === 'rj45');
  const sfp = all.filter((port) => port.kind === 'sfp');
  const twoRows = rj45.length > 8;
  const columns = twoRows ? Math.ceil(rj45.length / 2) : rj45.length;
  const pitch = type === 'switch' ? JACK.pitch : JACK.pitch * 1.35; // routeurs et pare-feu : prises espacées
  const groups = type === 'switch' ? Math.floor(Math.max(columns - 1, 0) / JACK.group) : 0;
  const portsWidth = Math.max(columns - 1, 0) * pitch + groups * JACK.groupGap + JACK.width;
  const sfpWidth = sfp.length ? 0.06 + sfp.length * SFP.pitch : 0;
  const consoleWidth = type === 'switch' && !model.os ? 0 : 0.16; // prise console des équipements administrables
  const needed = LEFT_ZONE + portsWidth + sfpWidth + consoleWidth + RIGHT_MARGIN + (form.ears ? 0.12 : 0);
  const width = Math.max(form.minWidth, needed);
  const height = form.height;
  const depth = form.depth;
  const z = depth / 2;
  const left = -width / 2 + (form.ears ? 0.06 : 0) + LEFT_ZONE;

  const ports = [];
  rj45.forEach((port, i) => {
    const column = twoRows ? Math.floor(i / 2) : i;
    const row = twoRows ? i % 2 : 0; // ports impairs en haut, pairs en bas, comme sur un vrai switch
    const flip = twoRows && row === 1; // la rangée du bas a ses prises retournées
    const x = left + JACK.width / 2 + column * pitch + (type === 'switch' ? Math.floor(column / JACK.group) * JACK.groupGap : 0);
    const y = twoRows ? height * (row === 0 ? 0.67 : 0.31) : height * 0.47;
    ports.push({ ...port, x, y, z, face: 'front', flip, leds: jackLeds(x, y, flip, z) });
  });
  const sfpLeft = left + portsWidth + 0.06;
  sfp.forEach((port, i) => {
    const x = sfpLeft + SFP.width / 2 + i * SFP.pitch;
    const y = height * 0.47;
    ports.push({ ...port, x, y, z, face: 'front', flip: false, leds: [{ role: 'link', x: x - 0.02, y: y + SFP.height / 2 + 0.014, z }, { role: 'act', x: x + 0.02, y: y + SFP.height / 2 + 0.014, z }] });
  });

  const extras = {};
  if (consoleWidth) extras.console = { x: width / 2 - (form.ears ? 0.06 : 0) - RIGHT_MARGIN - 0.05, y: height * 0.47, z };
  return { width, height, depth, ports, extras };
}

/** Serveur 2U : baies de disques à gauche, panneau de contrôle à droite, prises réseau à l'arrière. */
function serverLayout(model, form) {
  const width = form.minWidth;
  const { height, depth } = form;
  const all = portsOf(model);
  const ports = all.map((port, i) => {
    // Prises à l'arrière (face -z) ; leurs voyants sont aussi reportés en façade (« LAN 1 », « LAN 2 »).
    const x = 0.45 + i * 0.13;
    const y = height * 0.35;
    const front = { x: width / 2 - 0.36 + i * 0.07, y: height * 0.32, z: depth / 2 };
    return {
      ...port, x: -x, y, z: -depth / 2, face: 'back', flip: false,
      leds: [...jackLeds(-x, y, false, -depth / 2), { role: 'link', ...front }, { role: 'act', ...front, y: front.y - 0.045 }],
    };
  });
  const bays = model.ports[0] && model.ports[0].speed >= 10000 ? 10 : 8;
  return { width, height, depth, ports, extras: { bays } };
}

/** Poste de travail : écran, unité centrale, clavier et souris. La carte réseau est derrière l'unité centrale. */
function workstationLayout(model) {
  const all = portsOf(model);
  const tower = { x: 0.82, width: 0.26, height: 0.56, depth: 0.56 };
  const ports = all.map((port, i) => {
    const back = { x: tower.x, y: 0.16 + i * 0.08, z: -tower.depth / 2 - 0.04 };
    // Témoin « LAN » en façade de l'unité centrale : lien et activité.
    const front = { x: tower.x + 0.07, y: tower.height - 0.1 - i * 0.05, z: tower.depth / 2 - 0.04 };
    return {
      ...port, ...back, face: 'back', flip: false,
      leds: [{ role: 'link', ...front, x: front.x - 0.03 }, { role: 'act', ...front }, ...jackLeds(back.x, back.y, false, back.z)],
    };
  });
  return { width: 2.0, height: 0.8, depth: 1.0, ports, extras: { tower } };
}

/**
 * Disposition complète d'un équipement décrit en JSON ({ type, model? }).
 * @returns {{ modelId, type, form, width, height, depth, ears, finish, accent, brand, label,
 *            ports: Array<{ name, speed, kind, x, y, z, face, flip, leds: Array<{ role, x, y, z }> }>,
 *            status: Array<{ role, x, y, z }>, extras: Object }}
 */
export function deviceLayout(def) {
  const modelId = modelIdOf(def) || DEFAULT_MODEL[def.type];
  const model = MODELS[modelId];
  if (!model) throw new Error(`Modèle inconnu pour le type « ${def.type} »`);
  const formName = MODEL_FORMS[modelId] || TYPE_FORMS[model.type] || 'desktop';
  const form = FORMS[formName];
  const geometry = formName === 'workstation' ? workstationLayout(model)
    : formName === 'rack2u' ? serverLayout(model, form)
      : frontPanel(model, form, model.type);
  const { width, height, depth } = geometry;
  // Voyants d'état (alimentation, système), sous la marque, à gauche de la façade.
  const statusLeft = formName === 'workstation' ? null : -width / 2 + (form.ears ? 0.06 : 0) + 0.07;
  const status = statusLeft === null ? [] : [
    { role: 'pwr', x: statusLeft, y: height * 0.3, z: depth / 2 },
    { role: 'sys', x: statusLeft + 0.05, y: height * 0.3, z: depth / 2 },
  ];
  return {
    modelId,
    type: model.type,
    form: formName,
    width, height, depth,
    ears: form.ears,
    finish: BEIGE.has(modelId) ? 'beige' : 'dark',
    accent: TYPE_ACCENTS[model.type] || '#94a3b8',
    brand: BRANDS[model.os] || (model.type === 'host' ? 'NX' : 'NETCORE'),
    label: model.name.split(' ').pop(),
    ports: geometry.ports,
    status,
    extras: geometry.extras,
  };
}

/**
 * État des deux voyants d'un port, comme sur un vrai switch :
 *   - lien : éteint sans câble ou port éteint (shutdown) ; vert à 1 Gb/s et plus, orange
 *     en dessous (100 Mb/s : la carte ou le câble bride le lien) ; orange clignotant si le
 *     port est bloqué (err-disabled, sécurité de port) ;
 *   - activité : vert qui clignote pendant qu'une trame passe.
 * `simNow` (temps simulé) rythme l'activité : en pause, le voyant se fige. `realNow` rythme
 * le clignotement d'un port bloqué, visible même en pause.
 * @returns {{ link: 'off'|'green'|'amber', act: 'off'|'green' }}
 */
export function portLedState({ cabled = false, shutdown = false, errDisabled = false, speed = 1000, active = false, simNow = 0, realNow = 0 } = {}) {
  if (!cabled || shutdown) return { link: 'off', act: 'off' };
  if (errDisabled) return { link: Math.floor(realNow / 450) % 2 === 0 ? 'amber' : 'off', act: 'off' };
  return {
    link: speed >= 1000 ? 'green' : 'amber',
    act: active && Math.floor(simNow / 70) % 2 === 0 ? 'green' : 'off',
  };
}
