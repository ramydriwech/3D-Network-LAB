// Laboratoire réseau (demande du superviseur, S7) : Steve entre dans une salle où les
// équipements du scénario sont montés dans des baies ou posés sur des postes de travail.
//
// Ce module ne fait que la 3D et la caméra :
//   - la SALLE : faux plancher technique, murs avec plinthes et prises réseau, faux plafond à
//     dalles lumineuses, fenêtre, porte avec panneau « Sortie », tableau blanc et ses feutres,
//     extincteur, horloge, et une ÉTAGÈRE-CATALOGUE avec un exemplaire de chaque modèle (on
//     la vise pour en ajouter un) ;
//   - les MEUBLES (labFurniture.js) : un poste de travail (bureau et fauteuil) sous chaque PC,
//     une BAIE 19 pouces autour de chaque serveur, switch, routeur ou pare-feu. La topologie
//     elle-même (src/render/index.js) est réduite à l'échelle et posée à hauteur de travail ;
//   - les CHEMINS DE CÂBLES suspendus sous le plafond : dans la salle, les câbles y montent au
//     lieu de traverser l'allée (render.setCableRouting, mode « tray ») ;
//   - la VUE À LA PREMIÈRE PERSONNE : ZQSD / WASD ou flèches pour marcher, souris pour
//     regarder (verrouillage du pointeur), Maj pour aller plus vite ; sur écran tactile,
//     on glisse pour regarder et le joystick de l'interface fait avancer ;
//   - la VUE DE SURVOL : la caméra orbitale habituelle, au-dessus de la salle sans plafond.
// L'interface (src/ui/labHud.js) affiche le viseur, la fiche de l'objet visé et ouvre les
// consoles ; en VR, src/xr/ reprend la même salle à l'échelle réelle.
//
// Les murs et le plafond sont des plans à une seule face tournée vers l'intérieur : vus de
// l'extérieur (survol), ils disparaissent d'eux-mêmes, sans calcul supplémentaire.

import * as THREE from 'three';
import { Topics } from '../sim/events.js';
import { MODELS, CABLES, modelsOfType } from '../sim/catalog.js';
import { cableColor } from './cableRoute.js';
import { addContactShadow, castShadows } from './contactShadow.js';
import {
  rack, workstationDesk, floorTexture, wallTexture, ceilingTexture, windowUnit, whiteboardFrame,
  extinguisher, exitSign, wallClock, wallOutlet, cableTrays, cableCoil,
} from './labFurniture.js';
import { mergeStatic } from './mergeStatic.js';

/** Échelle de la topologie dans la salle : un PC de la scène (1 unité) fait 50 cm. */
export const LAB_SCALE = 0.5;
/** Hauteur de travail des bureaux et des équipements montés en baie (m). */
export const BENCH_HEIGHT = 0.8;
/** Hauteur des yeux de Steve (m). */
export const EYE_HEIGHT = 1.65;
const ROOM_HEIGHT = 3.2;
/** Hauteur des chemins de câbles (m) et la même en unités de la topologie (repère de `world`). */
const TRAY_HEIGHT = 2.5;
const TRAY_Y = (TRAY_HEIGHT - 0.8) / 0.5;
const MARGIN = 2.6; // espace libre entre les équipements et les murs
const WALK_SPEED = 1.8; // m/s
const RUN_FACTOR = 2.2;
const LOOK_SPEED = 0.0024; // radians par pixel
const REACH = 4; // portée du viseur (m)
const BODY_RADIUS = 0.28;
const CATALOG_TYPES = ['host', 'server', 'switch', 'router', 'firewall'];

const shared = new Map();
const mat = (key, make) => { if (!shared.has(key)) shared.set(key, make()); return shared.get(key); };
const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });

/** Panneau de texte (tableau blanc, enseigne) : canevas → texture → plan. */
function textPanel(width, height, draw, { pixels = 512 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = Math.round(pixels * (height / width));
  draw(canvas.getContext('2d'), canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.userData.canvas = canvas;
  return mesh;
}

/** Découpe un texte en lignes qui tiennent dans `max` pixels. */
function wrap(g, text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > max && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {Object} render  API de rendu (src/render/index.js)
 * @param {Object} sim     simulation
 */
export function createLab(render, sim) {
  const { scene, camera, controls, world } = render;
  const room = new THREE.Group();
  room.name = 'laboratoire';
  room.visible = false;
  scene.add(room);
  // En VR, on ne déplace pas l'utilisateur mais la salle (et la topologie) autour de lui :
  // `vrRoot` porte l'inverse de la position de Steve. Cela marche de la même façon pour les
  // trois voies VR (WebGPU directe, pont WebGPU, WebGL 2) et les panneaux restent près de lui.
  const vrRoot = new THREE.Group();
  vrRoot.name = 'laboratoire-vr';
  const vr = { on: false, enteredForVR: false, x: 0, z: 0, yaw: 0 };
  const furniture = new THREE.Group();
  const shelf = new THREE.Group();
  room.add(furniture, shelf);
  // La salle porte et reçoit des ombres : le rendu recadre sa lumière sur elle quand elle est visible.
  if (render.shadowRoots) render.shadowRoots.add(room);

  let active = false;
  let mode = 'walk'; // 'walk' (première personne) | 'overview' (survol)
  let bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  let obstacles = []; // { minX, maxX, minZ, maxZ } et { x, z, r }
  let saved = null;
  let poster = null;
  let posterLines = { title: '', body: '' };
  const listeners = { target: new Set(), mode: new Set(), tap: new Set() };
  const position = new THREE.Vector3();
  const look = { yaw: 0, pitch: 0 };
  const keys = new Set();
  const move = { x: 0, y: 0 }; // joystick tactile (-1 … 1)
  let target = null;
  let targetClock = 0;
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;

  // --------------------------------------------------------------- construction
  function clear(group) { while (group.children.length) group.remove(group.children[0]); }

  /** Position (scène) d'un point de la topologie (coordonnées du scénario). */
  const toRoom = (p) => new THREE.Vector3(p[0] * LAB_SCALE, BENCH_HEIGHT + (p[1] || 0) * LAB_SCALE, p[2] * LAB_SCALE);

  let mergedMeshes = []; // maillages fusionnés de la construction précédente (à libérer)

  function build(scenario) {
    for (const mesh of mergedMeshes) mesh.geometry.dispose();
    mergedMeshes = [];
    clear(room);
    clear(furniture);
    clear(shelf);
    room.add(furniture, shelf);
    obstacles = [];
    const devices = (scenario && scenario.devices) || [];
    const box = new THREE.Box2(new THREE.Vector2(-3, -3), new THREE.Vector2(3, 3));
    for (const def of devices) box.expandByPoint(new THREE.Vector2(def.position[0] * LAB_SCALE, def.position[2] * LAB_SCALE));
    bounds = { minX: box.min.x - MARGIN, maxX: box.max.x + MARGIN + 1.2, minZ: box.min.y - MARGIN, maxZ: box.max.y + MARGIN + 1.2 }; // Box2 : y = profondeur (z)
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;

    // Faux plancher technique : dalles de 60 cm (motif de 2,4 m), légèrement satinées.
    const tiles = floorTexture().clone();
    tiles.needsUpdate = true;
    tiles.repeat.set(width / 2.4, depth / 2.4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.55, metalness: 0 }));
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.userData.kind = 'floor';
    room.add(floor);

    // Murs peints (une face, vers l'intérieur), bandeau bleu, plinthes et prises réseau.
    const stripeMat = mat('mat:stripe', () => standard(0x0ea5e9, { roughness: 0.6 }));
    const walls = [
      { w: width, x: cx, z: bounds.minZ, ry: 0 },
      { w: width, x: cx, z: bounds.maxZ, ry: Math.PI },
      { w: depth, x: bounds.minX, z: cz, ry: Math.PI / 2 },
      { w: depth, x: bounds.maxX, z: cz, ry: -Math.PI / 2 },
    ];
    const plinthMat = mat('mat:plinth', () => standard(0x3a4048, { roughness: 0.6 }));
    walls.forEach((wall, index) => {
      const paint = wallTexture().clone();
      paint.needsUpdate = true;
      paint.repeat.set(wall.w / 2, ROOM_HEIGHT / 2);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wall.w, ROOM_HEIGHT), new THREE.MeshStandardMaterial({ map: paint, roughness: 0.92 }));
      mesh.position.set(wall.x, ROOM_HEIGHT / 2, wall.z);
      mesh.rotation.y = wall.ry;
      mesh.receiveShadow = true;
      room.add(mesh);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(wall.w, 0.12), stripeMat);
      stripe.position.set(wall.x, 1.1, wall.z);
      stripe.rotation.y = wall.ry;
      stripe.translateZ(0.005);
      room.add(stripe);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(wall.w, 0.08, 0.015), plinthMat);
      plinth.position.set(wall.x, 0.04, wall.z);
      plinth.rotation.y = wall.ry;
      plinth.translateZ(0.008);
      room.add(plinth);
      // Prises réseau murales tous les 2,4 m (pas sur le mur de l'étagère, index 3).
      if (index === 3) return;
      for (let t = -wall.w / 2 + 1.2; t < wall.w / 2 - 0.6; t += 2.4) {
        if (index === 1 && Math.abs(t) < 1.2) continue; // pas derrière la porte
        const outlet = wallOutlet();
        outlet.position.set(wall.x, 0.32, wall.z);
        outlet.rotation.y = wall.ry;
        outlet.translateX(t);
        room.add(outlet);
      }
    });

    // Porte d'entrée (mur du fond, côté +z) et enseigne
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.15), mat('mat:door', () => standard(0x334155, { metalness: 0.3 })));
    door.position.set(cx, 1.075, bounds.maxZ - 0.01);
    door.rotation.y = Math.PI;
    room.add(door);
    const doorFrame = mat('mat:doorFrame', () => standard(0x94a3b8, { metalness: 0.5, roughness: 0.4 }));
    const piece = (size, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), doorFrame);
      mesh.position.set(x, y, z);
      room.add(mesh);
    };
    for (const dx of [-0.58, 0.58]) piece([0.06, 2.2, 0.06], cx + dx, 1.1, bounds.maxZ - 0.02); // huisserie
    piece([1.22, 0.06, 0.06], cx, 2.18, bounds.maxZ - 0.02);
    piece([0.14, 0.03, 0.05], cx - 0.4, 1.05, bounds.maxZ - 0.05); // poignée
    const exit = exitSign();
    exit.position.set(cx, 2.36, bounds.maxZ - 0.04);
    exit.rotation.y = Math.PI;
    room.add(exit);
    const fire = extinguisher();
    fire.position.set(cx + 1.3, 0, bounds.maxZ - 0.01);
    fire.rotation.y = Math.PI;
    room.add(fire);
    // Fenêtre sur le mur de gauche (côté -x) : un peu de ciel et de lumière du jour.
    const pane = windowUnit(Math.min(2.6, depth * 0.35), 1.25);
    pane.position.set(bounds.minX + 0.01, 1.88, cz); // au-dessus du bandeau bleu
    pane.rotation.y = Math.PI / 2;
    room.add(pane);
    const sign = textPanel(1.8, 0.32, (g, w, h) => {
      g.fillStyle = '#0f172a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#38bdf8'; g.font = `bold ${Math.round(h * 0.45)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('LAB RÉSEAU · NETWORK LAB', w / 2, h / 2);
    });
    sign.position.set(cx, 2.78, bounds.maxZ - 0.02);
    sign.rotation.y = Math.PI;
    room.add(sign);

    // Plafond, dalles lumineuses et deux lampes
    const ceilingMap = ceilingTexture().clone();
    ceilingMap.needsUpdate = true;
    ceilingMap.repeat.set(width / 0.6, depth / 0.6);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: ceilingMap, roughness: 0.9 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, ROOM_HEIGHT, cz);
    room.add(ceiling);
    // Dalle tournée vers le bas : comme le plafond, elle disparaît vue de dessus (survol).
    const panelGeo = mat('geo:panel', () => new THREE.PlaneGeometry(1.2, 0.6).rotateX(Math.PI / 2));
    const panelMat = mat('mat:panel', () => new THREE.MeshBasicMaterial({ color: 0xf1f5ff, toneMapped: false }));
    for (let x = bounds.minX + 2; x < bounds.maxX - 1; x += 3) {
      for (let z = bounds.minZ + 2; z < bounds.maxZ - 1; z += 3) {
        const light = new THREE.Mesh(panelGeo, panelMat);
        light.position.set(x, ROOM_HEIGHT - 0.02, z);
        room.add(light);
      }
    }
    for (const dx of [-0.25, 0.25]) {
      // Simple touche chaude : l'essentiel de la lumière vient de l'environnement (dalles du
      // plafond) et du « soleil » qui porte les ombres (scene.js, ambiance « lab »).
      const lamp = new THREE.PointLight(0xfff7ed, 1.5, Math.max(width, depth) * 1.5, 1);
      lamp.position.set(cx + dx * width, ROOM_HEIGHT - 0.4, cz);
      room.add(lamp);
    }

    // Meubles sous chaque équipement : poste de travail pour un PC, baie pour le reste. La baie
    // est taillée sur l'équipement qu'elle porte (dimensions de son modèle 3D).
    for (const def of devices) {
      const at = toRoom(def.position);
      const object = render.deviceObject ? render.deviceObject(def.id) : null;
      const layout = object && object.userData.layout;
      const lift = layout && layout.form === 'desktop' ? 0.02 : 0; // patins d'un boîtier de bureau
      const piece = def.type === 'host' ? workstationDesk({ top: BENCH_HEIGHT }) : rack({
        deviceWidth: (layout ? layout.width : 1.9) * LAB_SCALE,
        deviceDepth: (layout ? layout.depth : 1.0) * LAB_SCALE,
        deviceHeight: ((layout ? layout.height : 0.2) + lift) * LAB_SCALE,
        mountHeight: BENCH_HEIGHT,
        name: def.name,
      });
      piece.group.position.set(at.x, 0, at.z);
      castShadows(piece.group);
      addContactShadow(piece.group, { opacity: 0.5, spread: 1.25 });
      furniture.add(piece.group);
      obstacles.push({ minX: at.x - piece.half[0], maxX: at.x + piece.half[0], minZ: at.z - piece.half[1], maxZ: at.z + piece.half[1] });
      if (piece.extra) obstacles.push({ x: at.x + piece.extra.x, z: at.z + piece.extra.z, r: piece.extra.r });
    }

    // Tableau blanc (mur du fond, côté -z) : titre et consigne du scénario
    poster = textPanel(3.2, 1.6, () => {}, { pixels: 1024 });
    poster.userData.keep = true; // redessiné à chaque étape : pas fusionné
    poster.position.set(cx, 1.75, bounds.minZ + 0.02);
    room.add(poster);
    paintPoster();
    const board = whiteboardFrame(3.2, 1.6);
    board.position.set(cx, 1.75, bounds.minZ + 0.02);
    room.add(board);
    const clock = wallClock();
    clock.position.set(cx + 2.3, 2.6, bounds.minZ + 0.005);
    room.add(clock);

    // Chemins de câbles : là où passent les câbles (tracés en mode « tray » par le rendu).
    if (render.cableTrays) {
      const trays = cableTrays(render.cableTrays(), (x, z) => [x * LAB_SCALE, z * LAB_SCALE], TRAY_HEIGHT, ROOM_HEIGHT);
      room.add(trays);
    }

    buildShelf(cx);
    // Des milliers de pièces fixes deviennent une centaine de maillages (un par matériau).
    mergedMeshes = mergeStatic(room);
  }

  /**
   * Étagère-catalogue contre le mur de droite : un exemplaire de chaque modèle, et en haut un
   * rouleau de chaque type de câble. Chaque modèle est aussi grand que la place le permet, sans
   * dépasser sa taille dans la simulation (LAB_SCALE) : les PC, seuls à deux sur leur planche,
   * y ont leur taille réelle ; les switchs, cinq sur la leur, sont un peu réduits.
   */
  function buildShelf() {
    const x = bounds.maxX - 0.35;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const columns = Math.max(...CATALOG_TYPES.map((type) => modelsOfType(type).length));
    const length = Math.max(2.4, columns * 0.75 + 0.3);
    const depth = 0.5;
    const boardMat = mat('mat:shelf', () => standard(0x64748b, { metalness: 0.4, roughness: 0.5 }));
    const frame = new THREE.Group();
    frame.position.set(x, 0, cz);
    frame.rotation.y = -Math.PI / 2; // la façade regarde vers -x (l'intérieur de la salle)
    shelf.add(frame);
    const shortName = (name) => name.replace(/^(Commutateur( administrable)?|Routeur|Pare-feu|Serveur|Poste( de travail| ancien)?) /, '');
    const board = (y) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.03, depth), boardMat);
      mesh.position.set(0, y, 0);
      frame.add(mesh);
    };
    const label = (text, at, y, size = 0.22) => {
      if (!render.makeLabel) return;
      const tag = render.makeLabel([text], { size, background: 'rgba(15, 23, 42, 0.9)' });
      if (tag) { tag.position.set(at, y, 0.15); frame.add(tag); }
    };
    let y = 0.25;
    // Hauteur de chaque planche : les postes de travail (écran) sont les plus hauts.
    const ROW_HEIGHT = { host: 0.56, server: 0.32, switch: 0.3, router: 0.3, firewall: 0.3 };
    for (const type of CATALOG_TYPES) {
      board(y);
      const models = modelsOfType(type);
      const slot = length / models.length;
      const room = ROW_HEIGHT[type] - 0.12; // place sous l'étiquette
      models.forEach((model, column) => {
        const item = render.createDeviceModel({ type, model: model.id });
        const size = new THREE.Box3().setFromObject(item).getSize(new THREE.Vector3());
        const scale = Math.min(LAB_SCALE, (slot * 0.86) / size.x, room / size.y, (depth * 0.95) / size.z);
        const holder = new THREE.Group();
        holder.add(item);
        holder.scale.setScalar(scale);
        holder.position.set(-length / 2 + slot * (column + 0.5), y + 0.015, 0.02);
        holder.userData = { kind: 'catalog', type, model: model.id };
        frame.add(holder);
        label(shortName(model.name), holder.position.x, y + 0.015 + size.y * scale + 0.07);
      });
      y += ROW_HEIGHT[type];
    }
    // Planche des câbles : un rouleau de chaque type, de la couleur de sa gaine.
    board(y);
    const cableIds = Object.keys(CABLES);
    const cableSlot = length / cableIds.length;
    cableIds.forEach((id, column) => {
      const coil = cableCoil(cableColor(id), id === 'fibre');
      coil.position.set(-length / 2 + cableSlot * (column + 0.5), y + 0.015, 0.05);
      coil.userData = { kind: 'cable', cable: id };
      frame.add(coil);
      label(CABLES[id].name.replace('Fibre multimode ', 'Fibre '), coil.position.x, y + 0.34);
    });
    y += 0.42;
    const top = Math.max(2.4, y + 0.05);
    for (const side of [-1, 1]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.04, top, depth), boardMat);
      upright.position.set(side * (length / 2), top / 2, 0);
      frame.add(upright);
    }
    const head = textPanel(length, 0.28, (g, w, h) => {
      g.fillStyle = '#1e293b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fbbf24'; g.font = `bold ${Math.round(h * 0.5)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('CATALOGUE', w / 2, h / 2);
    });
    head.position.set(0, top + 0.16, 0.02);
    frame.add(head);
    castShadows(frame);
    obstacles.push({ minX: x - 0.3, maxX: bounds.maxX, minZ: cz - length / 2, maxZ: cz + length / 2 });
  }

  function paintPoster() {
    if (!poster) return;
    const canvas = poster.userData.canvas;
    const g = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#94a3b8'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#0f172a'; g.textBaseline = 'top';
    g.font = 'bold 54px system-ui, sans-serif';
    let y = 40;
    for (const line of wrap(g, posterLines.title, w - 80).slice(0, 2)) { g.fillText(line, 40, y); y += 64; }
    g.fillStyle = '#1d4ed8';
    g.font = '34px system-ui, sans-serif';
    y += 10;
    for (const line of wrap(g, posterLines.body, w - 80).slice(0, 7)) { g.fillText(line, 40, y); y += 44; }
    poster.material.map.needsUpdate = true;
  }

  // --------------------------------------------------------------- caméra et déplacement
  function collide(next) {
    next.x = Math.min(bounds.maxX - BODY_RADIUS, Math.max(bounds.minX + BODY_RADIUS, next.x));
    next.z = Math.min(bounds.maxZ - BODY_RADIUS, Math.max(bounds.minZ + BODY_RADIUS, next.z));
    for (const o of obstacles) {
      if (o.r) {
        const dx = next.x - o.x; const dz = next.z - o.z; const d = Math.hypot(dx, dz); const min = o.r + BODY_RADIUS;
        if (d < min && d > 1e-6) { next.x = o.x + (dx / d) * min; next.z = o.z + (dz / d) * min; }
        continue;
      }
      const minX = o.minX - BODY_RADIUS; const maxX = o.maxX + BODY_RADIUS; const minZ = o.minZ - BODY_RADIUS; const maxZ = o.maxZ + BODY_RADIUS;
      if (next.x > minX && next.x < maxX && next.z > minZ && next.z < maxZ) {
        // On sort par le côté le plus proche : on glisse le long du meuble.
        const pushes = [[next.x - minX, 'x', minX], [maxX - next.x, 'x', maxX], [next.z - minZ, 'z', minZ], [maxZ - next.z, 'z', maxZ]];
        pushes.sort((a, b) => a[0] - b[0]);
        next[pushes[0][1]] = pushes[0][2];
      }
    }
    return next;
  }

  function applyCamera() {
    camera.position.copy(position);
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  }

  function step(dt) {
    if (!active || mode !== 'walk' || render.isPresenting()) return;
    const seconds = dt / 1000;
    let forward = move.y; let strafe = move.x;
    if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) strafe -= 1;
    const length = Math.hypot(forward, strafe);
    if (length > 0) {
      const speed = WALK_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_FACTOR : 1) * seconds / Math.max(1, length);
      const sin = Math.sin(look.yaw); const cos = Math.cos(look.yaw);
      const next = position.clone();
      next.x += (-sin * forward + cos * strafe) * speed;
      next.z += (-cos * forward - sin * strafe) * speed;
      position.copy(collide(next));
    }
    applyCamera();
    targetClock += dt;
    if (targetClock > 90) { targetClock = 0; updateTarget(); }
  }

  /** Ce que le viseur (centre de l'écran) montre. */
  function aimAt(origin, direction) {
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(vr.on ? [...render.pickables(), shelf, room] : [...render.pickables(), shelf], true);
    for (const hit of hits) {
      for (let object = hit.object; object; object = object.parent) {
        const data = object.userData;
        if (data && data.kind === 'device') return { kind: 'device', id: data.id, distance: hit.distance };
        if (data && data.kind === 'catalog') return { kind: 'catalog', type: data.type, model: data.model, distance: hit.distance };
        if (data && data.kind === 'cable') return { kind: 'cable', cable: data.cable, distance: hit.distance };
        if (data && data.kind === 'floor' && vr.on) return { kind: 'floor', point: room.worldToLocal(hit.point.clone()), distance: hit.distance };
      }
    }
    return null;
  }

  function updateTarget() {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const hit = aimAt(camera.getWorldPosition(new THREE.Vector3()), direction);
    const same = (a, b) => (a && b ? a.kind === b.kind && a.id === b.id && a.model === b.model : a === b);
    if (!same(hit, target)) {
      target = hit;
      for (const fn of listeners.target) fn(target);
    }
  }

  // --------------------------------------------------------------- entrer, sortir, survoler
  function placeWorld() {
    world.scale.setScalar(LAB_SCALE);
    world.position.set(0, BENCH_HEIGHT, 0);
    if (render.grid) render.grid.visible = false;
    if (render.setLabelScale) render.setLabelScale(0.55);
  }

  function setMode(next) {
    mode = next;
    if (mode === 'walk') {
      controls.enabled = false;
      render.manualCamera = true;
      applyCamera();
    } else {
      if (document.pointerLockElement) document.exitPointerLock();
      render.manualCamera = false;
      controls.enabled = true;
      const box = new THREE.Box3(new THREE.Vector3(bounds.minX, 0, bounds.minZ), new THREE.Vector3(bounds.maxX, 2, bounds.maxZ));
      render.frameBox(box);
    }
    target = null;
    for (const fn of listeners.target) fn(null);
    for (const fn of listeners.mode) fn(mode);
  }

  function enter() {
    if (active) return;
    active = true;
    saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone(), keepCamera: render.keepCamera };
    render.keepCamera = true; // un rechargement ne recadre pas la caméra du labo
    if (render.setAmbience) render.setAmbience('lab');
    // Dans la salle, les câbles montent dans les chemins de câbles (avant de construire la salle :
    // elle dessine les chemins là où passent les câbles).
    if (render.setCableRouting) render.setCableRouting({ mode: 'tray', height: TRAY_Y });
    build(sim.scenario);
    room.visible = true;
    placeWorld();
    // Steve entre par la porte et regarde la salle.
    position.set((bounds.minX + bounds.maxX) / 2, EYE_HEIGHT, bounds.maxZ - 0.9);
    look.yaw = 0;
    look.pitch = -0.18;
    setMode('walk');
  }

  // --------------------------------------------------------------- VR (échelle réelle)
  function applyVR() {
    vrRoot.rotation.set(0, -vr.yaw, 0);
    vrRoot.position.set(-vr.x, 0, -vr.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -vr.yaw);
    vrRoot.updateMatrixWorld(true);
  }

  /** Entrée en VR : la salle à l'échelle 1, Steve à la porte. */
  function enterVR() {
    vr.enteredForVR = !active;
    if (!active) enter();
    if (document.pointerLockElement) document.exitPointerLock();
    vr.on = true;
    scene.add(vrRoot);
    vrRoot.add(room, world);
    vr.x = position.x;
    vr.z = position.z;
    vr.yaw = look.yaw;
    if (render.setLabelScale) render.setLabelScale(0.7);
    applyVR();
  }

  function exitVR() {
    if (!vr.on) return;
    vr.on = false;
    scene.add(room, world);
    scene.remove(vrRoot);
    vrRoot.position.set(0, 0, 0);
    vrRoot.rotation.set(0, 0, 0);
    position.set(vr.x, EYE_HEIGHT, vr.z);
    look.yaw = vr.yaw;
    if (vr.enteredForVR) exit();
    else { placeWorld(); setMode('walk'); }
  }

  /** Où se trouve la tête (casque) dans la salle : la position réelle s'ajoute à celle de Steve. */
  function headInRoom() {
    const head = camera.getWorldPosition(new THREE.Vector3());
    return room.worldToLocal(head);
  }

  function exit() {
    if (!active) return;
    if (vr.on) { vr.on = false; scene.add(room, world); scene.remove(vrRoot); vrRoot.position.set(0, 0, 0); vrRoot.rotation.set(0, 0, 0); }
    active = false;
    if (document.pointerLockElement) document.exitPointerLock();
    room.visible = false;
    if (render.setAmbience) render.setAmbience('studio');
    if (render.setCableRouting) render.setCableRouting({ mode: 'floor' });
    world.scale.setScalar(1);
    world.position.set(0, 0, 0);
    if (render.grid) render.grid.visible = true;
    if (render.setLabelScale) render.setLabelScale(1);
    render.manualCamera = false;
    controls.enabled = true;
    if (saved) {
      render.keepCamera = saved.keepCamera;
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      controls.target.copy(saved.target);
      controls.update();
    }
    target = null;
    keys.clear();
    for (const fn of listeners.target) fn(null);
    for (const fn of listeners.mode) fn(null);
  }

  // --------------------------------------------------------------- entrées
  const canvas = render.domElement;
  const typing = (event) => {
    const el = event.target;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  window.addEventListener('keydown', (event) => {
    if (!active || typing(event)) return;
    keys.add(event.code);
    if (mode === 'walk' && /^(Arrow|Space)/.test(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  // Souris : verrouillée, elle tourne la tête ; sur écran tactile, on glisse pour regarder.
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (!active || mode !== 'walk') return;
    if (event.pointerType === 'mouse') {
      event.stopImmediatePropagation(); // ni sélection au hasard, ni glisser-déposer de l'éditeur
      if (event.button !== 0) return;
      if (document.pointerLockElement === canvas) {
        // Clic au viseur : ce qui est au centre de l'écran.
        updateTarget();
        for (const fn of listeners.tap) fn(target);
      } else if (canvas.requestPointerLock) {
        try { const request = canvas.requestPointerLock(); if (request && request.catch) request.catch(() => {}); } catch { /* refusé */ }
      }
      return;
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    event.stopImmediatePropagation();
  }, true);
  canvas.addEventListener('pointermove', (event) => {
    if (!active || mode !== 'walk') return;
    if (document.pointerLockElement === canvas) {
      turn(event.movementX, event.movementY);
      event.stopImmediatePropagation();
    } else if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = event.clientX; drag.y = event.clientY;
      turn(dx * 1.6, dy * 1.6);
      event.stopImmediatePropagation();
    }
  }, true);
  canvas.addEventListener('pointerup', (event) => {
    if (drag && drag.id === event.pointerId) {
      const tap = drag.moved < 8;
      drag = null;
      // Un appui bref sur un objet : comme un clic au viseur, mais à l'endroit touché.
      if (tap) {
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = aimAt(raycaster.ray.origin, raycaster.ray.direction);
        for (const fn of listeners.tap) fn(hit);
      }
      event.stopImmediatePropagation();
    }
  }, true);

  function turn(dx, dy) {
    look.yaw -= dx * LOOK_SPEED;
    look.pitch = Math.max(-1.35, Math.min(1.35, look.pitch - dy * LOOK_SPEED));
  }

  render.onFrame(step);
  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => {
    if (!active) return;
    const keep = { x: position.x, z: position.z };
    build(scenario);
    placeWorld();
    // Steve reste où il est (dans la salle éventuellement agrandie).
    position.set(keep.x, EYE_HEIGHT, keep.z);
    position.copy(collide(position));
    if (mode === 'overview' && !render.keepCamera) setMode('overview');
  });

  return {
    enter,
    exit,
    get active() { return active; },
    get mode() { return mode; },
    setMode,
    toggleMode() { setMode(mode === 'walk' ? 'overview' : 'walk'); },
    get target() { return target; },
    get bounds() { return { ...bounds }; },
    /** Position de Steve (m, coordonnées de la scène). */
    get position() { return position.clone(); },
    /** Place Steve en (x, z) (m) regardant vers `yaw` ou vers le point `[x, z]` donné. */
    teleport(x, z, face) {
      position.copy(collide(new THREE.Vector3(x, EYE_HEIGHT, z)));
      if (Array.isArray(face)) look.yaw = Math.atan2(-(face[0] - position.x), -(face[1] - position.z));
      else if (typeof face === 'number') look.yaw = face;
      // Le regard descend vers le bureau ou la tablette de baie où se trouve l'objet.
      if (Array.isArray(face)) look.pitch = Math.atan2(BENCH_HEIGHT + 0.15 - EYE_HEIGHT, Math.hypot(face[0] - position.x, face[1] - position.z));
      applyCamera();
      updateTarget();
    },
    /** Joystick tactile : x à droite, y en avant (-1 … 1). */
    setMove(x, y) { move.x = x; move.y = y; },
    setPoster(title, body) { posterLines = { title, body }; paintPoster(); },
    /** Point du sol devant Steve, en coordonnées du scénario (pour poser un nouvel équipement). */
    spotAhead(distance = 1.6) {
      let from = position.clone();
      let yaw = look.yaw;
      if (vr.on) {
        from = headInRoom();
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        yaw = Math.atan2(-forward.x, -forward.z) + vr.yaw;
      }
      const direction = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const spot = from.addScaledVector(direction, distance);
      return [Math.round((spot.x / LAB_SCALE) * 2) / 2, 0, Math.round((spot.z / LAB_SCALE) * 2) / 2];
    },
    /** Visée depuis un rayon quelconque (manette VR) : équipement, modèle du catalogue ou sol. */
    aimAt,
    enterVR,
    exitVR,
    get inVR() { return vr.on; },
    /** VR : téléporte Steve sur le point du sol visé (coordonnées de la salle). */
    teleportVR(point) {
      // La tête n'est pas forcément au centre de l'aire de jeu : on décale pour qu'elle arrive au point.
      const head = headInRoom();
      const next = collide(new THREE.Vector3(point.x, 0, point.z));
      vr.x += next.x - head.x;
      vr.z += next.z - head.z;
      applyVR();
    },
    /** VR : rotation par crans (« snap turn ») autour de la tête. */
    turnVR(angle) {
      const head = headInRoom();
      vr.yaw += angle;
      applyVR();
      const after = headInRoom();
      vr.x += head.x - after.x;
      vr.z += head.z - after.z;
      applyVR();
    },
    headInRoom,
    room,
    onTarget(fn) { listeners.target.add(fn); return () => listeners.target.delete(fn); },
    onMode(fn) { listeners.mode.add(fn); return () => listeners.mode.delete(fn); },
    onTap(fn) { listeners.tap.add(fn); return () => listeners.tap.delete(fn); },
    /** Modèles disponibles sur l'étagère (pour les tests et l'interface). */
    catalog: () => CATALOG_TYPES.flatMap((type) => modelsOfType(type).map((m) => ({ type, id: m.id, name: m.name, description: MODELS[m.id].description }))),
  };
}
