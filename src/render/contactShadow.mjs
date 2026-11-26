// Ombres de contact : une tache sombre et floue peinte sous un objet posé.
//
// Elle coûte presque rien (un plan transparent, une texture partagée) et marche à tous les
// niveaux de qualité, VR et mobile compris : c'est elle qui « pose » les objets sur le sol ou
// le bureau. En qualité haute, les ombres portées du soleil s'y ajoutent.

import * as THREE from 'three';

let texture = null;
let geometry = null;

/** Dégradé radial : noir au centre, transparent au bord. Dessiné une fois. */
function shadowTexture() {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Ajoute une ombre de contact sous `object` (posé en y = 0 dans son repère), à la taille de
 * son empreinte au sol. À appeler avant d'y accrocher étiquettes ou anneaux.
 * @returns {THREE.Mesh} la tache
 */
export function addContactShadow(object, { opacity = 0.55, spread = 1.35 } = {}) {
  if (!geometry) {
    geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
  }
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const inverse = object.matrixWorld.clone().invert();
  box.applyMatrix4(inverse); // empreinte dans le repère de l'objet
  const size = box.getSize(new THREE.Vector3());
  const material = new THREE.MeshBasicMaterial({
    map: shadowTexture(), transparent: true, opacity, depthWrite: false, toneMapped: false,
  });
  const blob = new THREE.Mesh(geometry, material);
  blob.scale.set(Math.max(size.x, 0.2) * spread, 1, Math.max(size.z, 0.2) * spread);
  blob.position.set((box.min.x + box.max.x) / 2, 0.004, (box.min.z + box.max.z) / 2);
  blob.renderOrder = -1;
  blob.raycast = () => {};
  blob.userData.contactShadow = true;
  object.add(blob);
  return blob;
}

/** Marque tous les maillages d'un objet pour porter et recevoir les ombres. */
export function castShadows(object, { cast = true, receive = true } = {}) {
  object.traverse((child) => {
    if (child.isMesh && !child.userData.contactShadow) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
  return object;
}
