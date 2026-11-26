// Mobilier et décor de la salle du laboratoire (lab.js), construits dans le code.
//
//   - BAIE 19 pouces (gris clair, teinte RAL 7035) autour de chaque équipement d'infrastructure :
//     montants, rails perforés, onduleur en bas, obturateurs ventilés gris très clair,
//     l'équipement sur sa tablette à hauteur de travail, passe-câbles à anneaux, panneau de
//     brassage bleu marine à prises et cordons, ventilation bleu ardoise ; des couleurs qui
//     tranchent avec celles des équipements. Bandeau de prises électriques, plaque au nom ;
//   - POSTE DE TRAVAIL : bureau à piètement métallique, voile de fond, fauteuil à cinq branches ;
//   - SALLE : faux plancher technique (dalles de 60 cm, dont des dalles perforées), murs peints
//     avec plinthes et prises réseau, faux plafond, fenêtre sur le ciel, tableau blanc encadré
//     avec ses feutres, extincteur, panneau « Sortie », horloge ;
//   - CHEMINS DE CÂBLES : échelles métalliques suspendues sous le plafond, là où passent les câbles.
//
// Unités : mètres de la salle (le repère de lab.js). Géométries, matériaux et textures partagés.

import * as THREE from 'three';
import { cablePlug } from './links.js';

const cache = new Map();
const shared = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};
const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...extra });
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const MAT = {
  rackFrame: () => shared('m:rackFrame', () => standard(0xc8ccd1, { metalness: 0.35, roughness: 0.5 })),
  steel: () => shared('m:steel', () => standard(0xb9c0c8, { metalness: 0.85, roughness: 0.32 })),
  darkPlastic: () => shared('m:darkPlastic', () => standard(0x15171b, { roughness: 0.6 })),
  laminate: () => shared('m:laminate', () => standard(0xd8d1c3, { roughness: 0.55 })),
  edge: () => shared('m:edge', () => standard(0x3a3f46, { roughness: 0.5 })),
  legs: () => shared('m:legs', () => standard(0x4b5260, { metalness: 0.7, roughness: 0.35 })),
  fabric: () => shared('m:fabric', () => standard(0x27344d, { roughness: 0.95 })),
  plinth: () => shared('m:plinth', () => standard(0x3a4048, { roughness: 0.6 })),
  white: () => shared('m:white', () => standard(0xf1f3f5, { roughness: 0.5 })),
  red: () => shared('m:red', () => standard(0xc81e1e, { roughness: 0.35, metalness: 0.2 })),
  aluminium: () => shared('m:alu', () => standard(0xcfd5dc, { metalness: 0.8, roughness: 0.3 })),
};
const unitBox = () => shared('g:box', () => new THREE.BoxGeometry(1, 1, 1));
const unitPlane = () => shared('g:plane', () => new THREE.PlaneGeometry(1, 1));
const unitCylinder = () => shared('g:cyl', () => new THREE.CylinderGeometry(1, 1, 1, 16));

function box(material, size, at, parent) {
  const mesh = new THREE.Mesh(unitBox(), material);
  mesh.scale.set(...size);
  mesh.position.set(...at);
  if (parent) parent.add(mesh);
  return mesh;
}
function cylinder(material, radius, height, at, parent) {
  const mesh = new THREE.Mesh(unitCylinder(), material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(...at);
  if (parent) parent.add(mesh);
  return mesh;
}

/** Texture de canevas, mise en cache par clé. */
function canvasTexture(key, width, height, draw, { repeat = false } = {}) {
  return shared('t:' + key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  });
}

/**
 * Matériau à texture répétée, partagé par toutes les pièces de même répétition : deux baies
 * de même hauteur ont ainsi les mêmes matériaux, et leurs pièces peuvent être fusionnées.
 */
function repeated(key, texture, repeatX, repeatY, extra) {
  const rx = Math.max(1, Math.round(repeatX * 2) / 2);
  const ry = Math.max(1, Math.round(repeatY * 2) / 2);
  return shared(`m:${key}:${rx}:${ry}`, () => {
    const map = texture.clone();
    map.needsUpdate = true;
    map.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map, ...extra });
  });
}

/** Panneau plat texturé (façade d'un élément de baie, affiche…), tourné vers +z. */
function panel(texture, width, height, at, parent, { emissive = false, metal = 0.4 } = {}) {
  const material = shared(`m:panel:${texture.uuid}:${emissive}:${metal}`, () => (emissive
    ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: metal })));
  const mesh = new THREE.Mesh(unitPlane(), material);
  mesh.scale.set(width, height, 1);
  mesh.position.set(...at);
  if (parent) parent.add(mesh);
  return mesh;
}

// --------------------------------------------------------------------------------- textures

/** Faux plancher technique : dalles de 60 cm aux joints sombres, dont deux perforées sur seize. */
export function floorTexture() {
  return canvasTexture('floor', 512, 512, (g, W) => {
    const tile = W / 4;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        const x = i * tile;
        const y = j * tile;
        const shade = ((i * 7 + j * 3) % 5) * 2;
        g.fillStyle = `rgb(${172 + shade}, ${179 + shade}, ${188 + shade})`;
        g.fillRect(x, y, tile, tile);
        const perforated = (i === 1 && j === 2) || (i === 3 && j === 0);
        if (perforated) {
          g.fillStyle = 'rgba(40, 46, 56, 0.55)';
          for (let a = 10; a < tile - 6; a += 8) for (let b = 10; b < tile - 6; b += 8) g.fillRect(x + a, y + b, 3, 3);
        }
        g.strokeStyle = 'rgba(70, 78, 90, 0.9)';
        g.lineWidth = 3;
        g.strokeRect(x + 1.5, y + 1.5, tile - 3, tile - 3);
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.lineWidth = 1;
        g.strokeRect(x + 4, y + 4, tile - 8, tile - 8);
      }
    }
  }, { repeat: true });
}

/** Mur peint : léger grain, pour éviter l'aplat parfait. */
export function wallTexture() {
  return canvasTexture('wall', 256, 256, (g, W, H) => {
    g.fillStyle = '#e3e7ec';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i += 1) {
      const v = Math.floor(Math.random() * 24) - 12;
      g.fillStyle = `rgba(${v > 0 ? 255 : 0}, ${v > 0 ? 255 : 0}, ${v > 0 ? 255 : 0}, ${Math.abs(v) / 260})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
  }, { repeat: true });
}

/** Faux plafond : dalles de 60 cm sur ossature claire. */
export function ceilingTexture() {
  return canvasTexture('ceiling', 256, 256, (g, W) => {
    g.fillStyle = '#f3f4f6';
    g.fillRect(0, 0, W, W);
    g.fillStyle = 'rgba(0, 0, 0, 0.04)';
    for (let i = 0; i < 900; i += 1) g.fillRect(Math.random() * W, Math.random() * W, 2, 2);
    g.strokeStyle = '#c5cbd3';
    g.lineWidth = 4;
    g.strokeRect(0, 0, W, W);
  }, { repeat: true });
}

// -------------------------------------------------------------------------------------- baie

const RACK_HEIGHT = 2.0;

function upsTexture() {
  return canvasTexture('ups', 512, 192, (g, W, H) => {
    g.fillStyle = '#1b1e22';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b2a3a';
    g.fillRect(W * 0.06, H * 0.25, W * 0.22, H * 0.4);
    g.fillStyle = '#5eead4';
    g.font = `700 ${Math.round(H * 0.16)}px ${FONT}`;
    g.fillText('230 V', W * 0.08, H * 0.42);
    g.fillText('100 %', W * 0.08, H * 0.6);
    g.fillStyle = '#d1d5db';
    g.font = `800 ${Math.round(H * 0.14)}px ${FONT}`;
    g.fillText('ONDULEUR 1500 VA', W * 0.36, H * 0.42);
    g.fillStyle = '#22c55e';
    for (let i = 0; i < 5; i += 1) g.fillRect(W * 0.36 + i * 26, H * 0.55, 18, 8);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let x = W * 0.72; x < W * 0.95; x += 12) for (let y = H * 0.2; y < H * 0.85; y += 12) g.fillRect(x, y, 6, 6);
  });
}
function railTexture() {
  return canvasTexture('rail', 32, 256, (g, W, H) => {
    g.fillStyle = '#a9afb7';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#4b525b';
    for (let y = 4; y < H; y += 11) g.fillRect(W * 0.3, y, W * 0.4, 6);
  }, { repeat: true });
}
function backPanelTexture() {
  return canvasTexture('rackBack', 128, 128, (g, W, H) => {
    g.fillStyle = '#9ea4ac';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#6b727b';
    for (let x = 4; x < W; x += 8) for (let y = 4; y < H; y += 8) g.fillRect(x, y, 4, 4);
  }, { repeat: true });
}
function plateTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e5e7eb';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#111827';
  g.font = `800 26px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`BAIE · ${name}`, 128, 25);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Éléments montés en façade. Leurs couleurs tranchent avec celles des équipements (boîtiers gris
// foncé) : obturateurs gris très clair, passe-câbles noir à anneaux métalliques, panneau de brassage
// bleu marine à prises blanches, ventilation bleu ardoise. On distingue d'un coup d'œil ce qui est
// « la baie » de ce qui est « l'équipement ».

/** Positions des 24 prises du panneau de brassage (fractions de la largeur, deux blocs de 12). */
const PATCH_PORTS = Array.from({ length: 24 }, (unused, i) => 0.1 + (i % 12) * 0.031 + (i >= 12 ? 0.42 : 0));

/** Obturateur 2U : gris très clair, rangées de fentes d'aération, quatre vis, bords marqués. */
function blankTexture() {
  return canvasTexture('blank2u', 512, 96, (g, W, H) => {
    g.fillStyle = '#dfe3e8';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(15, 23, 42, 0.25)'; // bords haut et bas
    g.fillRect(0, 0, W, 3);
    g.fillRect(0, H - 3, W, 3);
    g.fillStyle = '#5b6470'; // fentes d'aération
    for (const y of [H * 0.32, H * 0.56]) for (let x = W * 0.12; x < W * 0.88; x += 22) g.fillRect(x, y, 14, 6);
    for (const [x, y] of [[14, 14], [W - 22, 14], [14, H - 22], [W - 22, H - 22]]) { // vis
      g.fillStyle = '#4b5563';
      g.beginPath(); g.arc(x + 4, y + 4, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#cbd5e1';
      g.fillRect(x + 1, y + 3, 6, 2);
    }
  });
}

/** Plaque du panneau de brassage : bleu marine, numéros blancs au-dessus des prises, étiquette. */
function patchPlateTexture() {
  return canvasTexture('patchPlate', 1024, 120, (g, W, H) => {
    g.fillStyle = '#1e3a5f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e2e8f0';
    g.font = `700 17px ${FONT}`;
    g.textAlign = 'center';
    PATCH_PORTS.forEach((u, i) => g.fillText(String(i + 1), u * W, H * 0.2));
    g.textAlign = 'left';
    g.font = `800 15px ${FONT}`;
    g.fillText('BRASSAGE', W * 0.012, H * 0.62);
    g.fillStyle = 'rgba(226, 232, 240, 0.85)'; // bandeau d'étiquetage sous les prises
    g.fillRect(W * 0.09, H * 0.84, W * 0.82, 6);
  });
}

/** Plaque de ventilation : bleu ardoise, témoin vert, inscription. */
function fanPlateTexture() {
  return canvasTexture('fanPlate', 512, 96, (g, W, H) => {
    g.fillStyle = '#3f566f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e2e8f0';
    g.font = `800 16px ${FONT}`;
    g.fillText('VENTILATION', W * 0.03, H * 0.58);
    g.fillStyle = 'rgba(0, 0, 0, 0.25)';
    g.fillRect(0, H - 4, W, 4);
  });
}

/** Grille d'un ventilateur : anneaux et rayons clairs sur fond sombre. */
function fanGrilleTexture() {
  return canvasTexture('fanGrille', 128, 128, (g, W) => {
    const c = W / 2;
    g.fillStyle = '#0f172a';
    g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#cbd5e1';
    g.lineWidth = 4;
    for (const r of [16, 32, 48, 61]) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
    for (let a = 0; a < 4; a += 1) { g.beginPath(); g.moveTo(c + Math.cos(a * Math.PI / 4) * 61, c + Math.sin(a * Math.PI / 4) * 61); g.lineTo(c - Math.cos(a * Math.PI / 4) * 61, c - Math.sin(a * Math.PI / 4) * 61); g.stroke(); }
    g.fillStyle = '#64748b';
    g.beginPath(); g.arc(c, c, 10, 0, Math.PI * 2); g.fill();
  });
}

const FACE = {
  patchPlate: () => shared('m:patchPlate', () => new THREE.MeshStandardMaterial({ map: patchPlateTexture(), roughness: 0.5, metalness: 0.3 })),
  fanPlate: () => shared('m:fanPlate', () => new THREE.MeshStandardMaterial({ map: fanPlateTexture(), roughness: 0.5, metalness: 0.35 })),
  grille: () => shared('m:fanGrille', () => new THREE.MeshStandardMaterial({ map: fanGrilleTexture(), roughness: 0.45, metalness: 0.3 })),
  blank: () => shared('m:blank2u', () => new THREE.MeshStandardMaterial({ map: blankTexture(), roughness: 0.55, metalness: 0.25 })),
  cableManager: () => shared('m:cableManager', () => standard(0x111317, { roughness: 0.6, metalness: 0.2 })),
  keystone: () => shared('m:keystone', () => standard(0xf8fafc, { roughness: 0.45 })),
  hole: () => shared('m:keyHole', () => standard(0x05070a, { roughness: 0.8 })),
  cordWhite: () => shared('m:cordWhite', () => standard(0xe5e7eb, { roughness: 0.55 })),
  cordGrey: () => shared('m:cordGrey', () => standard(0x6b7280, { roughness: 0.55 })),
  fanLed: () => shared('m:fanLed', () => new THREE.MeshBasicMaterial({ color: 0x22e06a, toneMapped: false })),
};

/** Obturateurs 2U de y0 à y1 (petit jour entre deux plaques, comme de vraies plaques vissées). */
function blankPanels(group, inner, y0, y1, z) {
  const step = 0.09;
  for (let y = y0; y + 0.03 < y1; y += step) {
    const h = Math.min(step, y1 - y) - 0.004;
    const mesh = new THREE.Mesh(unitPlane(), FACE.blank());
    mesh.scale.set(inner, h, 1);
    mesh.position.set(0, y + h / 2, z);
    group.add(mesh);
  }
}

/** Passe-câbles horizontal : plaque noire et cinq anneaux métalliques en relief. */
function cableManager(group, inner, y, z) {
  box(FACE.cableManager(), [inner, 0.05, 0.02], [0, y + 0.025, z - 0.006], group);
  const ring = shared('g:dring', () => new THREE.TorusGeometry(0.018, 0.0045, 6, 14, Math.PI).rotateZ(-Math.PI / 2).rotateY(-Math.PI / 2));
  for (let i = 0; i < 5; i += 1) {
    const mesh = new THREE.Mesh(ring, MAT.steel());
    mesh.position.set(-inner / 2 + inner * (0.1 + i * 0.2), y + 0.025, z + 0.004);
    group.add(mesh);
  }
}

/** Panneau de brassage : plaque bleu marine, 24 prises blanches en relief, quatre cordons de brassage. */
function patchPanel(group, inner, y, z, ringY) {
  box(FACE.patchPlate(), [inner, 0.06, 0.016], [0, y + 0.03, z - 0.006], group);
  const plate = new THREE.Mesh(unitPlane(), FACE.patchPlate());
  plate.scale.set(inner, 0.06, 1);
  plate.position.set(0, y + 0.03, z + 0.0025);
  group.add(plate);
  const keystone = new THREE.InstancedMesh(unitBox(), FACE.keystone(), PATCH_PORTS.length);
  const hole = new THREE.InstancedMesh(unitBox(), FACE.hole(), PATCH_PORTS.length);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  const portX = (u) => -inner / 2 + u * inner;
  PATCH_PORTS.forEach((u, i) => {
    keystone.setMatrixAt(i, matrix.compose(at.set(portX(u), y + 0.028, z + 0.006), q, size.set(0.022, 0.026, 0.012)));
    hole.setMatrixAt(i, matrix.compose(at.set(portX(u), y + 0.026, z + 0.0125), q, size.set(0.014, 0.012, 0.002)));
  });
  for (const mesh of [keystone, hole]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh); }
  // Quatre cordons de brassage : de la prise, ils descendent dans les anneaux du passe-câbles.
  [[1, 'cordWhite'], [4, 'cordGrey'], [14, 'cordWhite'], [19, 'cordGrey']].forEach(([port, color], k) => {
    const x = portX(PATCH_PORTS[port]);
    const ringX = -inner / 2 + inner * (0.1 + Math.min(4, Math.round(PATCH_PORTS[port] * 5 - 0.5)) * 0.2);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, y + 0.026, z + 0.014),
      new THREE.Vector3(x, y + 0.02, z + 0.04),
      new THREE.Vector3((x + ringX) / 2, ringY + 0.01, z + 0.03),
      new THREE.Vector3(ringX + (k % 2 ? 0.006 : -0.006), ringY, z + 0.012),
      new THREE.Vector3(ringX + (k % 2 ? 0.05 : -0.05), ringY - 0.006, z + 0.016),
    ], false, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0035, 5, false), FACE[color]()));
  });
}

/** Ventilation : plaque bleu ardoise, trois ventilateurs à grille et anneau en relief, témoin vert. */
function fanTray(group, inner, y, z) {
  box(FACE.fanPlate(), [inner, 0.1, 0.016], [0, y + 0.05, z - 0.006], group);
  const plate = new THREE.Mesh(unitPlane(), FACE.fanPlate());
  plate.scale.set(inner, 0.1, 1);
  plate.position.set(0, y + 0.05, z + 0.0025);
  group.add(plate);
  const disc = shared('g:fanDisc', () => new THREE.CircleGeometry(0.038, 24));
  const rim = shared('g:fanRim', () => new THREE.TorusGeometry(0.039, 0.004, 6, 24));
  for (let i = 0; i < 3; i += 1) {
    const x = -inner / 2 + inner * (0.42 + i * 0.2);
    const grille = new THREE.Mesh(disc, FACE.grille());
    grille.position.set(x, y + 0.05, z + 0.004);
    group.add(grille);
    const ring = new THREE.Mesh(rim, MAT.steel());
    ring.position.set(x, y + 0.05, z + 0.006);
    group.add(ring);
  }
  const led = new THREE.Mesh(unitBox(), FACE.fanLed());
  led.scale.set(0.012, 0.012, 0.004);
  led.position.set(-inner / 2 + inner * 0.25, y + 0.05, z + 0.005);
  group.add(led);
}

/**
 * Baie sous un équipement : l'équipement (largeur `deviceWidth`, profondeur `deviceDepth`,
 * en mètres) est posé à `mountHeight`, centré dans la baie, façade vers +z.
 * @returns {{ group: THREE.Group, half: [number, number] }}
 */
export function rack({ deviceWidth = 0.95, deviceDepth = 0.5, deviceHeight = 0.1, mountHeight = 0.8, name = '' } = {}) {
  const group = new THREE.Group();
  const width = deviceWidth + 0.14;
  const depth = Math.max(deviceDepth + 0.22, 0.75);
  const H = RACK_HEIGHT;
  const inner = deviceWidth - 0.03; // largeur des éléments montés
  const front = deviceDepth / 2; // façade des éléments montés (alignée sur celle de l'équipement)
  const frame = MAT.rackFrame();
  // Montants, cadres haut et bas, socle et vérins.
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(frame, [0.045, H, 0.045], [x * (width / 2 - 0.0225), H / 2, z * (depth / 2 - 0.0225)], group);
  box(frame, [width, 0.05, depth], [0, H - 0.025, 0], group);
  box(frame, [width, 0.07, depth], [0, 0.06, 0], group);
  for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(MAT.steel(), 0.018, 0.03, [x * (width / 2 - 0.05), 0.015, z * (depth / 2 - 0.05)], group);
  // Rails perforés de montage, derrière les oreilles des équipements.
  const rail = repeated('rail', railTexture(), 1, (H - 0.16) / 0.2, { metalness: 0.5, roughness: 0.5 });
  for (const x of [-1, 1]) box(rail, [0.026, H - 0.16, 0.01], [x * (deviceWidth / 2 - 0.006), H / 2, front - 0.012], group);
  // Fond perforé (on ne voit pas le mur à travers la baie).
  const back = repeated('rackBack', backPanelTexture(), width / 0.25, H / 0.25, { roughness: 0.7, metalness: 0.3 });
  const backPanel = new THREE.Mesh(unitPlane(), back);
  backPanel.scale.set(width - 0.05, H - 0.1, 1);
  backPanel.position.set(0, H / 2, -depth / 2 + 0.03);
  group.add(backPanel);
  // Façade, du bas vers le haut, autour de l'équipement (jamais devant lui) : onduleur,
  // obturateurs, tablette et équipement, passe-câbles, panneau de brassage, obturateurs, ventilation.
  const z = front + 0.004;
  box(MAT.darkPlastic(), [inner, 0.3, deviceDepth * 0.9], [0, 0.26, front - deviceDepth * 0.45], group);
  panel(upsTexture(), inner, 0.3, [0, 0.26, z], group);
  blankPanels(group, inner, 0.42, mountHeight - 0.022, z);
  box(MAT.rackFrame(), [inner + 0.02, 0.018, deviceDepth + 0.04], [0, mountHeight - 0.009, 0], group); // tablette
  const top = mountHeight + deviceHeight + 0.015;
  cableManager(group, inner, top, z);
  patchPanel(group, inner, top + 0.065, z, top + 0.025);
  fanTray(group, inner, H - 0.17, z);
  blankPanels(group, inner, top + 0.135, H - 0.175, z);
  // Bandeau de prises électriques vertical, à l'arrière, avec son témoin.
  box(MAT.darkPlastic(), [0.05, H * 0.75, 0.05], [-width / 2 + 0.08, H * 0.5, -depth / 2 + 0.08], group);
  const led = new THREE.Mesh(unitBox(), shared('m:pduLed', () => new THREE.MeshBasicMaterial({ color: 0x22e06a, toneMapped: false })));
  led.scale.set(0.012, 0.012, 0.004);
  led.position.set(-width / 2 + 0.08, H * 0.86, -depth / 2 + 0.106);
  group.add(led);
  // Plaque au nom de l'équipement, en haut de la façade.
  const plate = new THREE.Mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: plateTexture(name), toneMapped: false }));
  plate.scale.set(Math.min(0.42, width * 0.5), 0.075, 1);
  plate.position.set(0, H - 0.025, depth / 2 + 0.002);
  group.add(plate);
  return { group, half: [width / 2, depth / 2] };
}

// ----------------------------------------------------------------------- poste de travail

/** Bureau, voile de fond et fauteuil (tourné vers le bureau). Le plateau est à `top` mètres. */
export function workstationDesk({ top = 0.8 } = {}) {
  const group = new THREE.Group();
  const W = 1.4;
  const D = 0.75;
  box(MAT.laminate(), [W, 0.03, D], [0, top - 0.015, 0], group);
  box(MAT.edge(), [W + 0.004, 0.032, 0.006], [0, top - 0.015, D / 2], group); // chant
  for (const x of [-1, 1]) {
    const lx = x * (W / 2 - 0.08);
    box(MAT.legs(), [0.06, top - 0.06, 0.06], [lx, (top - 0.03) / 2, 0], group);
    box(MAT.legs(), [0.06, 0.03, D - 0.06], [lx, 0.015, 0], group); // pied
    box(MAT.legs(), [0.05, 0.03, D - 0.12], [lx, top - 0.045, 0], group); // traverse
  }
  box(MAT.legs(), [W - 0.2, 0.36, 0.012], [0, top - 0.25, -D / 2 + 0.06], group); // voile de fond
  // Fauteuil : piètement à cinq branches et roulettes, vérin, assise, dossier, accoudoirs.
  const chair = new THREE.Group();
  chair.position.set(0.05, 0, D / 2 + 0.38);
  chair.rotation.y = 0.18;
  for (let i = 0; i < 5; i += 1) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 5) * Math.PI * 2;
    box(MAT.darkPlastic(), [0.3, 0.03, 0.04], [0.15, 0.07, 0], arm);
    const wheel = new THREE.Mesh(shared('g:wheel', () => new THREE.SphereGeometry(0.03, 10, 8)), MAT.darkPlastic());
    wheel.position.set(0.29, 0.03, 0);
    arm.add(wheel);
    chair.add(arm);
  }
  cylinder(MAT.steel(), 0.025, 0.36, [0, 0.26, 0], chair);
  box(MAT.fabric(), [0.5, 0.08, 0.48], [0, 0.47, 0], chair);
  box(MAT.fabric(), [0.46, 0.52, 0.07], [0, 0.82, 0.25], chair);
  box(MAT.darkPlastic(), [0.05, 0.2, 0.05], [0, 0.62, 0.25], chair);
  for (const x of [-1, 1]) {
    box(MAT.darkPlastic(), [0.04, 0.18, 0.04], [x * 0.26, 0.58, 0.02], chair);
    box(MAT.darkPlastic(), [0.06, 0.03, 0.26], [x * 0.26, 0.67, 0.02], chair);
  }
  group.add(chair);
  return { group, half: [W / 2 + 0.02, D / 2 + 0.02], extra: { x: chair.position.x, z: chair.position.z, r: 0.34 } };
}

// --------------------------------------------------------------------------------- décor

/** Fenêtre (vue sur le ciel) contre un mur ; tournée vers +z dans son repère. */
export function windowUnit(width = 2.4, height = 1.2) {
  const group = new THREE.Group();
  const sky = canvasTexture('sky', 256, 128, (g, W, H) => {
    const gradient = g.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#5aa2e6');
    gradient.addColorStop(0.65, '#b8dcf5');
    gradient.addColorStop(1, '#e8f1f6');
    g.fillStyle = gradient;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255, 255, 255, 0.75)'; // nuages
    for (const [x, y, r] of [[60, 34, 16], [80, 30, 20], [102, 36, 14], [180, 52, 12], [196, 48, 16]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#8ea6b8'; // silhouette d'immeubles
    for (const [x, w, h] of [[0, 40, 22], [44, 30, 34], [80, 50, 18], [150, 36, 28], [192, 64, 20]]) g.fillRect(x, H - h, w, h);
  });
  panel(sky, width, height, [0, 0, -0.005], group, { emissive: true });
  const frame = MAT.white();
  box(frame, [width + 0.1, 0.06, 0.08], [0, height / 2 + 0.03, 0], group);
  box(frame, [width + 0.1, 0.06, 0.08], [0, -height / 2 - 0.03, 0], group);
  for (const x of [-1, 0, 1]) box(frame, [0.05, height, 0.07], [x * (width / 2 + 0.025) * (x === 0 ? 0 : 1), 0, 0], group);
  box(frame, [width + 0.2, 0.03, 0.18], [0, -height / 2 - 0.07, 0.07], group); // appui
  return group;
}

/** Tableau blanc : cadre aluminium, auget et feutres (le tableau lui-même est dessiné par lab.js). */
export function whiteboardFrame(width, height) {
  const group = new THREE.Group();
  const alu = MAT.aluminium();
  for (const y of [-1, 1]) box(alu, [width + 0.08, 0.04, 0.04], [0, y * (height / 2 + 0.02), 0], group);
  for (const x of [-1, 1]) box(alu, [0.04, height + 0.08, 0.04], [x * (width / 2 + 0.02), 0, 0], group);
  box(alu, [width * 0.6, 0.025, 0.09], [0, -height / 2 - 0.05, 0.04], group); // auget
  [0x1d4ed8, 0xdc2626, 0x111827].forEach((color, i) => {
    const marker = cylinder(shared(`m:marker${i}`, () => standard(color, { roughness: 0.4 })), 0.011, 0.13, [-0.2 + i * 0.08, -height / 2 - 0.03, 0.05], group);
    marker.rotation.z = Math.PI / 2;
  });
  box(MAT.darkPlastic(), [0.12, 0.03, 0.05], [0.18, -height / 2 - 0.025, 0.05], group); // brosse
  return group;
}

/** Extincteur sur son support mural, avec sa signalétique. */
export function extinguisher() {
  const group = new THREE.Group();
  cylinder(MAT.red(), 0.075, 0.48, [0, 0.62, 0.09], group);
  cylinder(MAT.darkPlastic(), 0.03, 0.08, [0, 0.9, 0.09], group);
  box(MAT.darkPlastic(), [0.12, 0.02, 0.03], [0.04, 0.94, 0.09], group);
  box(MAT.darkPlastic(), [0.02, 0.32, 0.02], [0.07, 0.7, 0.16], group); // tuyau
  const sign = canvasTexture('fireSign', 128, 128, (g, W) => {
    g.fillStyle = '#c81e1e';
    g.fillRect(0, 0, W, W);
    g.fillStyle = '#ffffff';
    g.font = `800 18px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('EXTINCTEUR', W / 2, W * 0.88);
    g.fillRect(W * 0.42, W * 0.18, W * 0.16, W * 0.5);
  });
  panel(sign, 0.22, 0.22, [0, 1.35, 0.005], group, { emissive: true });
  return group;
}

/** Panneau lumineux « Sortie » au-dessus de la porte. */
export function exitSign() {
  const texture = canvasTexture('exit', 256, 96, (g, W, H) => {
    g.fillStyle = '#15803d';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.font = `800 34px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SORTIE · EXIT', W / 2, H / 2 + 2);
  });
  const group = new THREE.Group();
  box(MAT.white(), [0.42, 0.17, 0.05], [0, 0, -0.03], group);
  panel(texture, 0.38, 0.14, [0, 0, 0.0], group, { emissive: true });
  return group;
}

/** Horloge murale (10 h 10, l'heure des catalogues). */
export function wallClock() {
  const face = canvasTexture('clock', 128, 128, (g, W) => {
    const c = W / 2;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1f2937';
    g.lineWidth = 6;
    g.stroke();
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = '#111827';
      g.fillRect(c + Math.sin(a) * (c - 14) - 2, c - Math.cos(a) * (c - 14) - 2, 4, 4);
    }
    g.lineCap = 'round';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin((10 / 12) * Math.PI * 2 + 0.09) * c * 0.45, c - Math.cos((10 / 12) * Math.PI * 2 + 0.09) * c * 0.45); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin((2 / 12) * Math.PI * 2) * c * 0.7, c - Math.cos((2 / 12) * Math.PI * 2) * c * 0.7); g.stroke();
  });
  const group = new THREE.Group();
  const rim = cylinder(MAT.darkPlastic(), 0.17, 0.04, [0, 0, 0.02], group);
  rim.rotation.x = Math.PI / 2;
  const disc = new THREE.Mesh(shared('g:disc', () => new THREE.CircleGeometry(0.155, 32)), new THREE.MeshBasicMaterial({ map: face, toneMapped: false }));
  disc.position.z = 0.042;
  group.add(disc);
  return group;
}

/** Prise réseau murale double (deux RJ45). */
export function wallOutlet() {
  const group = new THREE.Group();
  box(MAT.white(), [0.09, 0.09, 0.02], [0, 0, 0.01], group);
  for (const x of [-1, 1]) box(shared('m:jackHole', () => standard(0x0b0c0e)), [0.022, 0.018, 0.004], [x * 0.02, 0, 0.021], group);
  return group;
}

// ----------------------------------------------------------------------- chemins de câbles

/**
 * Chemins de câbles en échelle, suspendus par des tiges filetées.
 * @param {Array<{ axis, at, from, to }>} lines  tronçons (repère de la topologie, cableTrays())
 * @param {(x: number, z: number) => [number, number]} toRoom  conversion vers la salle (mètres)
 * @param {number} height  hauteur du chemin (m) ; ceiling : hauteur du plafond (m)
 */
export function cableTrays(lines, toRoom, height, ceiling) {
  const group = new THREE.Group();
  const width = 0.3;
  const rungs = [];
  const rods = [];
  for (const line of lines) {
    const [x0, z0] = line.axis === 'x' ? toRoom(line.from, line.at) : toRoom(line.at, line.from);
    const [x1, z1] = line.axis === 'x' ? toRoom(line.to, line.at) : toRoom(line.at, line.to);
    const length = Math.hypot(x1 - x0, z1 - z0) + width;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const along = line.axis === 'x';
    for (const side of [-1, 1]) {
      const rail = box(MAT.steel(), along ? [length, 0.06, 0.018] : [0.018, 0.06, length], [cx + (along ? 0 : side * width / 2), height + 0.015, cz + (along ? side * width / 2 : 0)], group);
      rail.castShadow = true;
    }
    const count = Math.max(2, Math.floor(length / 0.25));
    for (let i = 0; i <= count; i += 1) {
      const t = -length / 2 + (i / count) * length;
      rungs.push(along ? [cx + t, cz, true] : [cx, cz + t, false]);
    }
    for (let t = -length / 2 + 0.3; t < length / 2; t += 1.5) rods.push(along ? [cx + t, cz, true] : [cx, cz + t, false]);
  }
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  if (rungs.length) {
    const mesh = new THREE.InstancedMesh(unitBox(), MAT.steel(), rungs.length);
    rungs.forEach(([x, z, along], i) => mesh.setMatrixAt(i, matrix.compose(position.set(x, height - 0.005, z), q, along ? scale.set(0.025, 0.015, width) : scale.set(width, 0.015, 0.025))));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  if (rods.length) {
    const drop = ceiling - height;
    const mesh = new THREE.InstancedMesh(unitCylinder(), MAT.steel(), rods.length * 2);
    rods.forEach(([x, z, along], i) => {
      for (const side of [-1, 1]) {
        // Une tige de chaque côté du chemin (de part et d'autre de sa largeur).
        const at = along ? position.set(x, height + drop / 2, z + side * 0.17) : position.set(x + side * 0.17, height + drop / 2, z);
        mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), matrix.compose(at, q, scale.set(0.006, drop, 0.006)));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

// ------------------------------------------------------------------ rouleaux de câbles (catalogue)

/**
 * Rouleau de câble pour l'étagère-catalogue : trois spires de la couleur de la gaine, accrochées
 * à une patère, et deux bouts qui pendent avec leur fiche (RJ45 transparente, ou connecteur
 * de fibre). Repère : origine au bas du rouleau, face vers +z ; environ 26 cm de haut.
 * @param {string} color  couleur de la gaine (cableColor)
 * @param {boolean} fibre connecteurs LC duplex (fibre) au lieu de fiches RJ45
 */
export function cableCoil(color, fibre = false) {
  const group = new THREE.Group();
  const jacket = shared(`m:coil:${color}`, () => standard(color, { roughness: 0.5 }));
  const loop = shared('g:coilLoop', () => new THREE.TorusGeometry(0.1, 0.011, 8, 40));
  [[0, 0, 0], [0.008, -0.006, 0.014], [-0.007, 0.004, 0.028]].forEach(([dx, dy, dz], i) => {
    const turn = new THREE.Mesh(loop, jacket);
    turn.position.set(dx, 0.13 + dy, dz - 0.014);
    turn.rotation.z = i * 0.35;
    group.add(turn);
  });
  // Patère : une tige métallique qui sort du fond de l'étagère.
  const hook = cylinder(MAT.steel(), 0.007, 0.12, [0, 0.23, -0.02], group);
  hook.rotation.x = Math.PI / 2;
  // Deux bouts qui pendent, terminés par le même connecteur que les câbles de la scène (links.js),
  // pointe en bas, tourné vers l'étudiant.
  for (const side of [-1, 1]) {
    const tail = cylinder(jacket, 0.008, 0.07, [side * 0.052, 0.095, 0.02], group);
    tail.rotation.z = side * 0.12;
    const plug = cablePlug(color, fibre);
    plug.scale.setScalar(0.6);
    plug.rotation.set(-Math.PI / 2, 0, 0);
    plug.rotation.order = 'YXZ';
    plug.rotation.y = side * 0.5;
    plug.position.set(side * 0.056, 0.02, 0.02);
    group.add(plug);
  }
  return group;
}
