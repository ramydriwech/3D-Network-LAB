// Fusion des pièces fixes d'un objet 3D en un maillage par matériau (moins d'appels de dessin).
//
// Utilisée pour chaque modèle d'équipement (deviceModels.js) et pour la salle du laboratoire
// (lab.js) : un équipement compte une vingtaine de pièces, la salle plusieurs milliers.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Fusionne les pièces FIXES d'un groupe qui partagent un matériau en un seul maillage : une
 * baie, un bureau ou un mur comptent des dizaines de pièces, la salle entière plusieurs
 * milliers d'appels de dessin sans cette étape (une centaine après). Sont laissés tels quels :
 * les objets qui portent userData.kind (sol à viser, modèles de l'étagère) et leurs enfants,
 * ceux marqués userData.keep (tableau blanc redessiné), les objets transparents et instanciés.
 * @returns {THREE.Mesh[]} les maillages fusionnés ajoutés à `root` (à libérer avec dispose())
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map(); // matériau -> géométries dans le repère de root
  const merged = [];
  const absorbed = [];
  root.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh || object.userData.kind || object.userData.keep) return;
    const material = object.material;
    if (!material || Array.isArray(material) || material.transparent) return;
    for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
      if (parent.userData && (parent.userData.kind || parent.userData.keep)) return;
    }
    const source = object.geometry;
    if (!source.attributes.uv || !source.attributes.normal) return;
    const geometry = new THREE.BufferGeometry();
    if (source.index) geometry.setIndex(source.index.clone());
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, source.attributes[name].clone());
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(geometry);
    absorbed.push(object);
  });
  for (const object of absorbed) object.parent.remove(object);
  for (const [material, list] of buckets) {
    // Géométries indexées (boîtes) et non indexées (extrusions arrondies) : on aligne tout sur
    // la forme non indexée quand le mélange existe, sinon la fusion est impossible.
    const mixed = list.some((g) => !g.index) && list.some((g) => g.index);
    const geometries = mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
    if (mixed) for (const g of list) if (g.index) g.dispose();
    const geometry = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.merged = true;
    root.add(mesh);
    merged.push(mesh);
  }
  return merged;
}
