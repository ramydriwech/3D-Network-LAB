// Génère les modèles 3D légers des équipements au format GLB (glTF 2.0 binaire).
// Aucun logiciel de modélisation ni dépendance : chaque modèle est un assemblage de
// boîtes et de cylindres décrit ci-dessous. Quelques kilo-octets par fichier.
//
//   node tools/make-models.mjs        -> écrit assets/models/{pc,server,switch,router,firewall}.glb
//
// Convention : origine au sol, au centre ; axe Y vers le haut ; face avant vers +Z.

import { mkdirSync, writeFileSync } from 'node:fs';

const hex = (value) => [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];

/** Boîte centrée en `at`, de dimensions `size` : 24 sommets (normales nettes), 12 triangles. */
function box(size, at) {
  const [w, h, d] = size.map((v) => v / 2);
  const faces = [
    { n: [0, 0, 1], v: [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]] },
    { n: [0, 0, -1], v: [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d]] },
    { n: [1, 0, 0], v: [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d]] },
    { n: [-1, 0, 0], v: [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]] },
    { n: [0, 1, 0], v: [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]] },
    { n: [0, -1, 0], v: [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, i) => {
    for (const v of face.v) {
      positions.push(v[0] + at[0], v[1] + at[1], v[2] + at[2]);
      normals.push(...face.n);
    }
    indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { positions, normals, indices };
}

/** Cylindre vertical centré en `at`. */
function cylinder(radius, height, at, segments = 20) {
  const positions = [];
  const normals = [];
  const indices = [];
  const half = height / 2;
  for (let i = 0; i <= segments; i++) { // flanc
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(at[0] + x * radius, at[1] - half, at[2] + z * radius, at[0] + x * radius, at[1] + half, at[2] + z * radius);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  for (const side of [1, -1]) { // couvercles
    const center = positions.length / 3;
    positions.push(at[0], at[1] + side * half, at[2]);
    normals.push(0, side, 0);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(at[0] + Math.cos(angle) * radius, at[1] + side * half, at[2] + Math.sin(angle) * radius);
      normals.push(0, side, 0);
    }
    for (let i = 0; i < segments; i++) {
      if (side === 1) indices.push(center, center + i + 2, center + i + 1);
      else indices.push(center, center + i + 1, center + i + 2);
    }
  }
  return { positions, normals, indices };
}

/** Assemble des pièces [{ shape, color, emissive? }] en un fichier GLB. */
function buildGlb(name, parts) {
  // Une primitive par matériau : les pièces de même couleur sont fusionnées.
  const groups = new Map();
  for (const part of parts) {
    const key = `${part.color}/${part.emissive || 0}`;
    if (!groups.has(key)) groups.set(key, { color: part.color, emissive: part.emissive || 0, positions: [], normals: [], indices: [] });
    const group = groups.get(key);
    const offset = group.positions.length / 3;
    group.positions.push(...part.shape.positions);
    group.normals.push(...part.shape.normals);
    group.indices.push(...part.shape.indices.map((index) => index + offset));
  }

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const primitives = [];
  let byteOffset = 0;
  const pushView = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
    chunks.push(padded);
    byteOffset += padded.length;
    return bufferViews.length - 1;
  };

  for (const group of groups.values()) {
    const positions = new Float32Array(group.positions);
    const normals = new Float32Array(group.normals);
    const indices = new Uint16Array(group.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], positions[i + axis]);
        max[axis] = Math.max(max[axis], positions[i + axis]);
      }
    }
    accessors.push({ bufferView: pushView(positions, 34962), componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: pushView(normals, 34962), componentType: 5126, count: normals.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: pushView(indices, 34963), componentType: 5123, count: indices.length, type: 'SCALAR' });
    const material = {
      pbrMetallicRoughness: { baseColorFactor: [...hex(group.color), 1], metallicFactor: 0.1, roughnessFactor: 0.6 },
    };
    if (group.emissive) material.emissiveFactor = hex(group.emissive);
    materials.push(material);
    primitives.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: materials.length - 1 });
  }

  const json = {
    asset: { version: '2.0', generator: '3D network topology — tools/make-models.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // « glTF »
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // « JSON »
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // « BIN »
  return Buffer.concat([header, jsonHeader, jsonBytes, binHeader, bin]);
}

const part = (shape, color, emissive) => ({ shape, color, emissive });

export const MODELS = {
  // PC : écran, pied, clavier.
  pc: [
    part(box([0.55, 0.05, 0.32], [0, 0.025, -0.1]), 0x334155),
    part(box([0.09, 0.3, 0.07], [0, 0.2, -0.1]), 0x334155),
    part(box([1.15, 0.72, 0.07], [0, 0.7, -0.1]), 0x1e293b),
    part(box([1.03, 0.6, 0.02], [0, 0.7, -0.06]), 0x3b82f6, 0x1d4ed8),
    part(box([0.8, 0.04, 0.26], [0, 0.02, 0.38]), 0x475569),
  ],
  // Serveur : tour avec façade, baies et voyants.
  server: [
    part(box([0.72, 1.6, 0.95], [0, 0.8, 0]), 0x312e81),
    part(box([0.6, 0.16, 0.02], [0, 1.35, 0.48]), 0x8b5cf6, 0x5b21b6),
    part(box([0.6, 0.16, 0.02], [0, 1.1, 0.48]), 0x8b5cf6, 0x5b21b6),
    part(box([0.6, 0.16, 0.02], [0, 0.85, 0.48]), 0x8b5cf6, 0x5b21b6),
    part(box([0.6, 0.16, 0.02], [0, 0.6, 0.48]), 0x4c1d95),
    part(box([0.06, 0.06, 0.02], [0.24, 0.3, 0.48]), 0x22c55e, 0x16a34a),
    part(box([0.06, 0.06, 0.02], [0.12, 0.3, 0.48]), 0x22c55e, 0x16a34a),
  ],
  // Switch : boîtier plat, rangée de ports en façade.
  switch: [
    part(box([1.9, 0.32, 0.95], [0, 0.16, 0]), 0x065f46),
    part(box([1.9, 0.03, 0.95], [0, 0.335, 0]), 0x10b981),
    ...Array.from({ length: 8 }, (unused, i) => part(box([0.15, 0.13, 0.02], [-0.77 + i * 0.22, 0.16, 0.485]), 0x0f172a)),
    ...Array.from({ length: 8 }, (unused, i) => part(box([0.05, 0.03, 0.02], [-0.77 + i * 0.22, 0.27, 0.485]), 0xfde047, 0xca8a04)),
  ],
  // Routeur : boîtier cylindrique, deux antennes, voyants.
  router: [
    part(cylinder(0.78, 0.34, [0, 0.17, 0], 28), 0xc2410c),
    part(cylinder(0.6, 0.04, [0, 0.36, 0], 28), 0xfb923c),
    part(cylinder(0.035, 0.75, [-0.45, 0.72, -0.35], 8), 0x1e293b),
    part(cylinder(0.035, 0.75, [0.45, 0.72, -0.35], 8), 0x1e293b),
    part(box([0.08, 0.05, 0.03], [-0.2, 0.2, 0.775]), 0x22c55e, 0x16a34a),
    part(box([0.08, 0.05, 0.03], [0, 0.2, 0.78]), 0x22c55e, 0x16a34a),
    part(box([0.08, 0.05, 0.03], [0.2, 0.2, 0.775]), 0x38bdf8, 0x0284c7),
  ],
  // Pare-feu : boîtier 1U rouge brique, ailettes de refroidissement, 3 ports colorés
  // par zone (vert inside, rouge outside, orange dmz) et un bouclier en façade.
  firewall: [
    part(box([1.7, 0.42, 0.95], [0, 0.21, 0]), 0x7c2d12),
    part(box([1.7, 0.03, 0.95], [0, 0.435, 0]), 0xea580c),
    ...Array.from({ length: 6 }, (unused, i) => part(box([0.03, 0.06, 0.8], [-0.6 + i * 0.24, 0.48, 0]), 0x431407)),
    part(box([0.28, 0.24, 0.02], [-0.55, 0.22, 0.485]), 0xfb923c, 0xc2410c),
    part(box([0.16, 0.13, 0.02], [0.1, 0.2, 0.485]), 0x22c55e, 0x15803d),
    part(box([0.16, 0.13, 0.02], [0.35, 0.2, 0.485]), 0xef4444, 0xb91c1c),
    part(box([0.16, 0.13, 0.02], [0.6, 0.2, 0.485]), 0xf59e0b, 0xb45309),
  ],
};

export function buildAll() {
  return Object.fromEntries(Object.entries(MODELS).map(([name, parts]) => [name, buildGlb(name, parts)]));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const out = new URL('../assets/models/', import.meta.url);
  mkdirSync(out, { recursive: true });
  for (const [name, glb] of Object.entries(buildAll())) {
    writeFileSync(new URL(`${name}.glb`, out), glb);
    console.log(`assets/models/${name}.glb  ${glb.length} octets`);
  }
}
