// Modèles 3D réalistes des équipements, construits dans le code à partir de leur fiche du
// catalogue (disposition calculée par deviceLayout.js). Aucun fichier à télécharger.
//
//   - switch, routeur, pare-feu : boîtier métallique aux arêtes arrondies (baie 1U avec ses
//     oreilles de fixation, ou petit boîtier de bureau sur patins), façade imprimée (marque,
//     modèle, numéros de ports), prises RJ45 et cages SFP, couvercle à fentes d'aération ;
//   - serveur : boîtier 2U, baies de disques, panneau de contrôle, prises à l'arrière ;
//   - poste de travail : écran allumé, unité centrale, clavier et souris.
//
// Chaque prise a deux voyants (lien, activité) que portLeds.js allume pendant la simulation.
// Tous les voyants d'un équipement forment UN seul objet (InstancedMesh) : un appel de dessin.
// Géométries, matériaux et textures sont partagés entre équipements (mobile, VR).
//
// L'objet rendu porte dans userData :
//   ports : { nom: Vector3 }  point de branchement de chaque port (repère du modèle) ;
//   leds  : { mesh, ports: { nom: { link: [i…], act: [i…] } }, status: [i…] }.

import * as THREE from 'three';
import { deviceLayout, LED_COLORS } from './deviceLayout.js';
import { mergeStatic } from './mergeStatic.js';

const cache = new Map();
const shared = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};
const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...extra });

// --- Matériaux partagés
const MAT = {
  chassis: () => shared('m:chassis', () => standard(0x5d646e, { metalness: 0.7, roughness: 0.38 })),
  chassisBeige: () => shared('m:chassisBeige', () => standard(0xd9cfb6, { roughness: 0.65, metalness: 0 })),
  silver: () => shared('m:silver', () => standard(0xc5cad2, { metalness: 0.9, roughness: 0.28 })),
  jack: () => shared('m:jack', () => standard(0x08090b, { roughness: 0.85, metalness: 0 })),
  rubber: () => shared('m:rubber', () => standard(0x111214, { roughness: 0.95, metalness: 0 })),
  plastic: () => shared('m:plastic', () => standard(0x1a1d22, { roughness: 0.55, metalness: 0.05 })),
  plasticBeige: () => shared('m:plasticBeige', () => standard(0xcfc4a8, { roughness: 0.7, metalness: 0 })),
  caddy: () => shared('m:caddy', () => standard(0x2a2e35, { roughness: 0.5, metalness: 0.5 })),
  consoleJack: () => shared('m:consoleJack', () => standard(0x2563eb, { roughness: 0.5, metalness: 0.1 })),
  led: () => shared('m:led', () => new THREE.MeshBasicMaterial({ toneMapped: false })),
};

// --- Géométries partagées
const GEO = {
  jackFrame: () => shared('g:jackFrame', () => new THREE.BoxGeometry(0.074, 0.06, 0.016)),
  jackHole: () => shared('g:jackHole', () => new THREE.BoxGeometry(0.058, 0.044, 0.018)),
  sfpCage: () => shared('g:sfpCage', () => new THREE.BoxGeometry(0.1, 0.045, 0.016)),
  sfpSlot: () => shared('g:sfpSlot', () => new THREE.BoxGeometry(0.084, 0.022, 0.018)),
  led: () => shared('g:led', () => new THREE.BoxGeometry(0.016, 0.011, 0.008)),
  screw: () => shared('g:screw', () => new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10).rotateX(Math.PI / 2)),
  foot: () => shared('g:foot', () => new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12)),
  unit: () => shared('g:unit', () => new THREE.BoxGeometry(1, 1, 1)),
  plane: () => shared('g:plane', () => new THREE.PlaneGeometry(1, 1)),
};

/** Boîte aux arêtes arrondies (extrusion d'un rectangle arrondi, avec chanfrein), posée sur y = 0. */
export function roundedBox(width, height, depth, radius = 0.015) {
  const key = `g:rbox:${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}:${radius}`;
  return shared(key, () => {
    const b = Math.min(radius, width / 4, height / 4, depth / 4);
    const w = width - 2 * b;
    const h = height - 2 * b;
    const r = Math.min(b, w / 2, h / 2);
    const shape = new THREE.Shape();
    const x = -w / 2;
    const y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3,
    });
    geometry.translate(0, height / 2, -(depth - 2 * b) / 2);
    geometry.computeVertexNormals();
    return geometry;
  });
}

/** Maillage d'une boîte unité mise à l'échelle (géométrie partagée). */
function block(material, size, at) {
  const mesh = new THREE.Mesh(GEO.unit(), material);
  mesh.scale.set(...size);
  mesh.position.set(...at);
  return mesh;
}

/** Texture dessinée dans un canevas, mise en cache. */
function canvasTexture(key, width, height, draw) {
  return shared('t:' + key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Façade imprimée d'un boîtier : fond brossé, liseré du type, marque, modèle, numéros des ports. */
function frontTexture(layout, faceWidth) {
  const key = `front:${layout.modelId}:${faceWidth.toFixed(3)}`;
  const W = 1024;
  const H = Math.max(96, Math.round(W * (layout.height / faceWidth)));
  return canvasTexture(key, W, H, (g) => {
    const beige = layout.finish === 'beige';
    const gradient = g.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, beige ? '#ddd3bb' : '#2b3037');
    gradient.addColorStop(1, beige ? '#c9bea3' : '#1b1e23');
    g.fillStyle = gradient;
    g.fillRect(0, 0, W, H);
    // Métal brossé : fines lignes horizontales.
    g.globalAlpha = beige ? 0.05 : 0.08;
    for (let y = 0; y < H; y += 2) {
      g.fillStyle = (y / 2) % 2 ? '#ffffff' : '#000000';
      g.fillRect(0, y, W, 1);
    }
    g.globalAlpha = 1;
    const px = (x) => ((x + faceWidth / 2) / faceWidth) * W;
    const py = (y) => H - (y / layout.height) * H;
    const unit = W / faceWidth; // pixels par unité de scène
    // Liseré de la couleur du type, à gauche.
    g.fillStyle = layout.accent;
    g.fillRect(Math.round(0.018 * unit), Math.round(H * 0.12), Math.max(4, Math.round(0.012 * unit)), Math.round(H * 0.76));
    // Marque et modèle.
    const ink = beige ? '#3a342a' : '#e5e9f0';
    const muted = beige ? '#6d6450' : '#8a94a6';
    g.fillStyle = ink;
    g.textBaseline = 'alphabetic';
    g.font = `800 ${Math.round(Math.min(H * 0.2, 0.05 * unit))}px ${FONT}`;
    g.fillText(layout.brand, Math.round(0.05 * unit), Math.round(H * 0.42));
    g.fillStyle = muted;
    g.font = `600 ${Math.round(Math.min(H * 0.15, 0.036 * unit))}px ${FONT}`;
    g.fillText(layout.label, Math.round(0.05 * unit), Math.round(H * 0.6));
    // Repères des voyants d'état.
    g.font = `600 ${Math.round(Math.min(H * 0.09, 0.022 * unit))}px ${FONT}`;
    for (const led of layout.status) {
      g.fillText(led.role.toUpperCase(), px(led.x) - 0.016 * unit, py(led.y) + H * 0.13);
    }
    // Numéros des ports (au-dessus de la rangée du haut, au-dessous de celle du bas).
    g.fillStyle = muted;
    g.textAlign = 'center';
    g.font = `600 ${Math.round(Math.min(H * 0.1, 0.03 * unit))}px ${FONT}`;
    for (const port of layout.ports) {
      if (port.face !== 'front') continue;
      const label = port.name.replace(/^p/, '').replace(/^g0\//, '').replace(/^u/, 'U');
      const offset = (port.kind === 'sfp' ? 0.04 : 0.045) * (port.flip ? -1 : 1);
      const y = py(port.y + offset) + (port.flip ? H * 0.06 : -H * 0.005);
      g.fillText(label, px(port.x), y);
    }
    // Prise console.
    if (layout.extras.console) {
      g.fillText('CONSOLE', px(layout.extras.console.x), py(layout.extras.console.y + 0.045));
    }
    // Grille d'aération sur la partie libre à droite (routeurs, pare-feu).
    const lastPort = Math.max(...layout.ports.filter((p) => p.face === 'front').map((p) => p.x), -faceWidth / 2 + 0.4);
    const ventFrom = px(lastPort + 0.12);
    const ventTo = layout.extras.console ? px(layout.extras.console.x - 0.12) : W - 0.06 * unit;
    if (ventTo - ventFrom > 0.15 * unit) {
      g.fillStyle = beige ? 'rgba(60, 50, 30, 0.35)' : 'rgba(0, 0, 0, 0.55)';
      const step = Math.max(6, Math.round(0.022 * unit));
      for (let x = ventFrom; x < ventTo - step; x += step) {
        for (let y = H * 0.25; y < H * 0.78; y += step) {
          g.beginPath();
          g.arc(x + step / 2, y + step / 2, step * 0.28, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  });
}

/** Couvercle : tôle à fentes d'aération et petit liseré de la couleur du type à l'avant. */
function lidTexture(layout) {
  return canvasTexture(`lid:${layout.form}:${layout.accent}:${layout.finish}`, 512, 256, (g, W, H) => {
    const beige = layout.finish === 'beige';
    g.fillStyle = beige ? '#d6ccb3' : '#5a616b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = beige ? 'rgba(80, 70, 50, 0.35)' : 'rgba(0, 0, 0, 0.5)';
    for (let row = 0; row < 3; row += 1) {
      for (let i = 0; i < 18; i += 1) {
        g.fillRect(W * 0.1 + i * W * 0.045, H * (0.2 + row * 0.12), W * 0.022, H * 0.08);
      }
    }
    g.fillStyle = layout.accent; // bande avant (en bas de la texture) : reconnaître le type de loin
    g.fillRect(0, H - 26, W, 26);
    g.fillStyle = layout.accent;
    g.font = `800 30px ${FONT}`;
    g.fillText(layout.brand, W * 0.1, H * 0.8);
  });
}

/** Voyants : une seule InstancedMesh par équipement ; renvoie l'index de chaque voyant. */
function buildLeds(group, layout) {
  const entries = [];
  const ports = {};
  for (const port of layout.ports) {
    ports[port.name] = { link: [], act: [] };
    for (const led of port.leds) {
      ports[port.name][led.role].push(entries.length);
      entries.push(led);
    }
  }
  const status = [];
  for (const led of layout.status) {
    status.push(entries.length);
    entries.push(led);
  }
  if (!entries.length) return null;
  const mesh = new THREE.InstancedMesh(GEO.led(), MAT.led(), entries.length);
  const matrix = new THREE.Matrix4();
  const off = new THREE.Color(LED_COLORS.off);
  const green = new THREE.Color(LED_COLORS.green);
  entries.forEach((led, i) => {
    const back = led.z < 0;
    matrix.makeRotationY(back ? Math.PI : 0).setPosition(led.x, led.y, led.z + (back ? -0.01 : 0.01));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, off);
  });
  for (const i of status) mesh.setColorAt(i, green); // sous tension
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.raycast = () => {}; // un clic sur un voyant sélectionne l'équipement, pas le voyant
  mesh.computeBoundingSphere();
  group.add(mesh);
  return { mesh, ports, status };
}

/** Prises RJ45 et cages SFP (deux InstancedMesh chacune : cadre et ouverture). */
function buildJacks(group, layout) {
  const rj45 = layout.ports.filter((port) => port.kind === 'rj45');
  const sfp = layout.ports.filter((port) => port.kind === 'sfp');
  const matrix = new THREE.Matrix4();
  const place = (list, geometry, material, dz) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((port, i) => {
      const back = port.face === 'back';
      matrix.makeRotationY(back ? Math.PI : 0).setPosition(port.x, port.y, port.z + (back ? -dz : dz));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  place(rj45, GEO.jackFrame(), MAT.silver(), 0.004);
  place(rj45, GEO.jackHole(), MAT.jack(), 0.006);
  place(sfp, GEO.sfpCage(), MAT.silver(), 0.004);
  place(sfp, GEO.sfpSlot(), MAT.jack(), 0.006);
}

/** Switch, routeur ou pare-feu : boîtier de baie ou de bureau. */
function buildAppliance(layout, def) {
  const group = new THREE.Group();
  const { width, height, depth } = layout;
  const beige = layout.finish === 'beige';
  const bodyWidth = layout.ears ? width - 0.1 : width;
  const body = new THREE.Mesh(roundedBox(bodyWidth, height, depth, layout.ears ? 0.01 : 0.022), beige ? MAT.chassisBeige() : MAT.chassis());
  group.add(body);
  // Façade imprimée, très légèrement en avant du boîtier.
  const faceWidth = bodyWidth - 0.012;
  const front = new THREE.Mesh(GEO.plane(), shared(`m:front:${layout.modelId}:${faceWidth.toFixed(3)}`, () => standard(0xffffff, {
    map: frontTexture(layout, faceWidth), metalness: beige ? 0 : 0.55, roughness: beige ? 0.7 : 0.42,
  })));
  front.scale.set(faceWidth, height - 0.012, 1);
  front.position.set(0, height / 2, depth / 2 + 0.002);
  group.add(front);
  // Couvercle à fentes d'aération.
  const lid = new THREE.Mesh(GEO.plane(), shared(`m:lid:${layout.form}:${layout.accent}:${layout.finish}`, () => standard(0xffffff, {
    map: lidTexture(layout), metalness: beige ? 0 : 0.7, roughness: beige ? 0.7 : 0.38,
  })));
  lid.rotation.x = -Math.PI / 2;
  lid.scale.set(bodyWidth - 0.03, depth - 0.03, 1);
  lid.position.y = height + 0.001;
  group.add(lid);
  if (layout.ears) {
    // Oreilles de fixation en baie, avec leurs vis.
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.03);
      group.add(block(MAT.chassis(), [0.06, height, 0.012], [x, height / 2, depth / 2 - 0.004]));
      for (const y of [height * 0.28, height * 0.72]) {
        const screw = new THREE.Mesh(GEO.screw(), MAT.silver());
        screw.position.set(x, y, depth / 2 + 0.004);
        group.add(screw);
      }
    }
  } else {
    // Patins en caoutchouc d'un boîtier de bureau.
    // (buildDeviceModel surélève ensuite le boîtier de leur hauteur.)
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const foot = new THREE.Mesh(GEO.foot(), MAT.rubber());
      foot.position.set(x * (width / 2 - 0.09), 0.01, z * (depth / 2 - 0.09));
      foot.userData.foot = true;
      group.add(foot);
    }
  }
  buildJacks(group, layout);
  if (layout.extras.console) {
    const { x, y, z } = layout.extras.console;
    group.add(block(MAT.consoleJack(), [0.07, 0.056, 0.014], [x, y, z + 0.004]));
    group.add(block(MAT.jack(), [0.054, 0.04, 0.016], [x, y, z + 0.006]));
  }
  // Pare-feu : la zone de chaque interface, d'une couleur sous la prise (vert inside,
  // rouge outside, orange dmz), comme les étiquettes collées sur un vrai pare-feu.
  if (layout.type === 'firewall') {
    const zones = { inside: 0x22c55e, outside: 0xef4444, dmz: 0xf59e0b };
    for (const iface of def.interfaces || []) {
      const port = layout.ports.find((p) => p.name === iface.name);
      if (!port || !zones[iface.zone]) continue;
      const tag = block(shared(`m:zone:${iface.zone}`, () => standard(zones[iface.zone], { roughness: 0.6 })), [0.074, 0.012, 0.004], [port.x, port.y - 0.042, port.z + 0.003]);
      group.add(tag);
    }
  }
  return group;
}

/** Serveur 2U : baies de disques, panneau de contrôle, prises à l'arrière. */
function buildServer(layout) {
  // Boîtier de base sans prises en façade : celles du serveur sont à l'arrière (plus bas).
  const group = buildAppliance({ ...layout, ports: [], extras: {} }, {});
  const { width, height, depth } = layout;
  // Baies de disques : tiroirs sombres avec poignée claire et témoin vert.
  const bays = layout.extras.bays;
  const columns = bays / 2;
  const left = -width / 2 + 0.5;
  const bayWidth = 0.13;
  const caddies = new THREE.InstancedMesh(GEO.unit(), MAT.caddy(), bays);
  const handles = new THREE.InstancedMesh(GEO.unit(), MAT.silver(), bays);
  const lights = new THREE.InstancedMesh(GEO.led(), MAT.led(), bays);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  for (let i = 0; i < bays; i += 1) {
    const x = left + (i % columns) * (bayWidth + 0.012);
    const y = height * (i < columns ? 0.71 : 0.29);
    caddies.setMatrixAt(i, matrix.compose(position.set(x, y, depth / 2 + 0.006), quaternion, scale.set(bayWidth, height * 0.38, 0.012)));
    handles.setMatrixAt(i, matrix.compose(position.set(x, y - height * 0.11, depth / 2 + 0.013), quaternion, scale.set(bayWidth * 0.8, 0.012, 0.006)));
    lights.setMatrixAt(i, matrix.compose(position.set(x + bayWidth * 0.36, y + height * 0.12, depth / 2 + 0.014), quaternion, scale.set(1, 1, 1)));
    lights.setColorAt(i, new THREE.Color(i % 3 === 0 ? LED_COLORS.blue : LED_COLORS.green));
  }
  for (const mesh of [caddies, handles, lights]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  lights.raycast = () => {};
  // Bouton d'alimentation, à droite.
  const button = new THREE.Mesh(GEO.screw(), MAT.silver());
  button.scale.setScalar(2.2);
  button.position.set(width / 2 - 0.16, height * 0.62, depth / 2 + 0.006);
  group.add(button);
  // Arrière : prises réseau (dans buildJacks) et bloc d'alimentation.
  buildJacks(group, layout);
  group.add(block(MAT.plastic(), [0.3, height * 0.5, 0.01], [width / 2 - 0.3, height * 0.4, -depth / 2 - 0.004]));
  return group;
}

/** Écran allumé : fond de bureau et fenêtre d'invite de commandes, teinte du type. */
function screenTexture(layout) {
  return canvasTexture(`screen:${layout.modelId}`, 512, 300, (g, W, H) => {
    const old = layout.finish === 'beige';
    const gradient = g.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, old ? '#0e3a5c' : '#0b1a3a');
    gradient.addColorStop(1, old ? '#155e75' : layout.accent);
    g.fillStyle = gradient;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(15, 23, 42, 0.92)'; // barre des tâches
    g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#0b0f17'; // fenêtre de terminal
    g.fillRect(W * 0.12, H * 0.14, W * 0.62, H * 0.58);
    g.fillStyle = '#1f2937';
    g.fillRect(W * 0.12, H * 0.14, W * 0.62, 18);
    g.fillStyle = '#86efac';
    g.font = '15px ui-monospace, Consolas, monospace';
    const lines = ['C:\\> ipconfig', '  IPv4 . . . : 192.168.1.10', '  Passerelle : 192.168.1.1', 'C:\\> ping 192.168.2.10', '  Réponse : temps=2 ms TTL=63', 'C:\\> _'];
    lines.forEach((line, i) => g.fillText(line, W * 0.14, H * 0.14 + 38 + i * 21));
  });
}

/** Clavier vu de dessus : touches claires sur fond sombre. */
function keyboardTexture(beige) {
  return canvasTexture(`keys:${beige}`, 512, 170, (g, W, H) => {
    g.fillStyle = beige ? '#bfb498' : '#15181c';
    g.fillRect(0, 0, W, H);
    g.fillStyle = beige ? '#e9e1cc' : '#2c3138';
    const key = 28;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        if (row === 4 && col > 3 && col < 11) continue;
        g.fillRect(10 + col * (key + 4) + (row % 2) * 6, 10 + row * (key + 4), key, key);
      }
    }
    g.fillRect(10 + 4 * (key + 4), 10 + 4 * (key + 4), 7 * (key + 4) - 4, key); // barre d'espace
  });
}

/** Poste de travail : écran sur pied, unité centrale, clavier et souris. */
function buildWorkstation(layout) {
  const group = new THREE.Group();
  const beige = layout.finish === 'beige';
  const plastic = beige ? MAT.plasticBeige() : MAT.plastic();
  // Écran : un ancien poste a un écran plus épais, à bords larges.
  const screen = beige ? { w: 0.9, h: 0.68, d: 0.32, border: 0.07, y: 0.24 } : { w: 1.15, h: 0.68, d: 0.045, border: 0.025, y: 0.36 };
  const base = new THREE.Mesh(roundedBox(0.36, 0.025, 0.26, 0.01), plastic); // socle
  base.position.set(0, 0, -0.12);
  group.add(base);
  group.add(block(plastic, [0.07, screen.y + 0.06, 0.04], [0, (screen.y + 0.06) / 2, -0.16])); // pied
  const frame = new THREE.Mesh(roundedBox(screen.w, screen.h, screen.d, 0.02), plastic);
  frame.position.set(0, screen.y, -0.1);
  group.add(frame);
  const panel = new THREE.Mesh(GEO.plane(), shared(`m:screen:${layout.modelId}`, () => new THREE.MeshStandardMaterial({
    color: 0x050608, roughness: 0.22, metalness: 0, emissive: 0xffffff, emissiveMap: screenTexture(layout), emissiveIntensity: 0.85,
  })));
  panel.scale.set(screen.w - 2 * screen.border, screen.h - 2 * screen.border, 1);
  panel.position.set(0, screen.y + screen.h / 2, -0.1 + screen.d / 2 + 0.002);
  group.add(panel);
  // Unité centrale : façade, bouton, témoin « LAN » (voyants des ports, voir deviceLayout).
  const tower = layout.extras.tower;
  const box = new THREE.Mesh(roundedBox(tower.width, tower.height, tower.depth, 0.018), beige ? MAT.chassisBeige() : MAT.chassis());
  box.position.set(tower.x, 0, 0);
  group.add(box);
  group.add(block(plastic, [tower.width - 0.04, tower.height - 0.06, 0.006], [tower.x, tower.height / 2, tower.depth / 2 + 0.002]));
  group.add(block(MAT.silver(), [0.11, 0.008, 0.004], [tower.x - 0.04, tower.height - 0.04, tower.depth / 2 + 0.007])); // lecteur
  const power = new THREE.Mesh(GEO.screw(), MAT.silver());
  power.scale.setScalar(1.6);
  power.position.set(tower.x - 0.05, tower.height - 0.1, tower.depth / 2 + 0.007);
  group.add(power);
  // Clavier et souris.
  const keyboard = new THREE.Mesh(roundedBox(0.86, 0.03, 0.28, 0.01), plastic);
  keyboard.position.set(-0.05, 0, 0.34);
  group.add(keyboard);
  const keys = new THREE.Mesh(GEO.plane(), shared(`m:keys:${beige}`, () => standard(0xffffff, { map: keyboardTexture(beige), roughness: 0.6 })));
  keys.rotation.x = -Math.PI / 2;
  keys.scale.set(0.82, 0.25, 1);
  keys.position.set(-0.05, 0.031, 0.34);
  group.add(keys);
  const mouse = new THREE.Mesh(roundedBox(0.07, 0.035, 0.12, 0.016), plastic);
  mouse.position.set(0.5, 0, 0.36);
  group.add(mouse);
  buildJacks(group, layout);
  return group;
}

/**
 * Objet 3D réaliste d'un équipement décrit en JSON ({ type, model?, interfaces? }).
 * Lève une erreur si le modèle est inconnu (la fabrique prend alors un modèle de secours).
 */
export function buildDeviceModel(def) {
  const layout = deviceLayout(def);
  const group = layout.form === 'workstation' ? buildWorkstation(layout)
    : layout.form === 'rack2u' ? buildServer(layout)
      : buildAppliance(layout, def);
  const leds = buildLeds(group, layout);
  // Une vingtaine de pièces fixes → un maillage par matériau (voyants et prises restent instanciés).
  mergeStatic(group);
  let root = group;
  let lift = 0;
  if (layout.form === 'desktop') {
    // Boîtier de bureau : posé sur ses patins.
    lift = 0.02;
    root = new THREE.Group();
    for (const foot of group.children.filter((child) => child.userData.foot)) root.add(foot);
    group.position.y = lift;
    root.add(group);
  }
  root.userData.layout = layout;
  root.userData.leds = leds;
  root.userData.ports = Object.fromEntries(layout.ports.map((port) => [port.name, new THREE.Vector3(port.x, port.y + lift, port.z)]));
  return root;
}
