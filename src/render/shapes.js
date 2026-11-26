// Formes simples des équipements (cubes, cylindres). Utilisées dès la S1, puis en
// solution de repli si un modèle GLB ne se charge pas.
// Géométries et matériaux sont créés une seule fois et partagés par tous les équipements.

import * as THREE from 'three';

export const DEVICE_COLORS = Object.freeze({
  host: 0x3b82f6,
  server: 0x8b5cf6,
  switch: 0x10b981,
  router: 0xf97316,
  firewall: 0xdc2626,
});

const cache = new Map();

function shared(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const material = (type) => shared('mat:' + type, () => new THREE.MeshStandardMaterial({
  color: DEVICE_COLORS[type] || 0x94a3b8, roughness: 0.55, metalness: 0.15,
}));

const GEOMETRIES = {
  host: () => new THREE.BoxGeometry(1.0, 0.8, 1.0),
  server: () => new THREE.BoxGeometry(0.8, 1.6, 1.0),
  switch: () => new THREE.BoxGeometry(1.8, 0.35, 1.0),
  router: () => new THREE.CylinderGeometry(0.75, 0.75, 0.45, 24),
  firewall: () => new THREE.BoxGeometry(1.7, 0.45, 1.0),
};

/** Hauteur approximative de chaque type, pour poser l'étiquette au-dessus. */
export const DEVICE_HEIGHT = Object.freeze({ host: 1.0, server: 1.6, switch: 0.4, router: 0.6, firewall: 0.55 });

/** Crée la forme simple d'un équipement, posée sur le sol (y = 0). */
export function createShape(type) {
  const geometry = shared('geo:' + type, GEOMETRIES[type] || GEOMETRIES.host);
  const mesh = new THREE.Mesh(geometry, material(type));
  geometry.computeBoundingBox();
  mesh.position.y = -geometry.boundingBox.min.y;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
