// Fabrique des équipements 3D (patron Factory) : à partir de l'objet JSON d'un équipement,
// elle retourne le bon modèle.
//   1. modèle réaliste construit dans le code d'après la fiche du catalogue (deviceModels.js) ;
//   2. à défaut, modèle GLB simplifié (assets/models/), chargé une fois puis cloné ;
//   3. à défaut, forme simple de shapes.js.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createShape } from './shapes.js';
import { buildDeviceModel } from './deviceModels.js';

const MODEL_FILES = Object.freeze({
  host: 'pc.glb',
  server: 'server.glb',
  switch: 'switch.glb',
  router: 'router.glb',
  firewall: 'firewall.glb',
});

export function createDeviceFactory(baseUrl = new URL('../../assets/models/', import.meta.url)) {
  const loader = new GLTFLoader();
  const models = new Map(); // type -> scène glTF d'origine

  /** Charge tous les modèles ; ne rejette jamais (un échec = forme simple). */
  async function load() {
    await Promise.all(Object.entries(MODEL_FILES).map(async ([type, file]) => {
      try {
        const gltf = await loader.loadAsync(new URL(file, baseUrl).href);
        models.set(type, gltf.scene);
      } catch (error) {
        console.warn(`[rendu] modèle ${file} indisponible, forme simple utilisée.`, error.message || error);
      }
    }));
  }

  /** Objet 3D d'un équipement décrit en JSON ({ type, model?, … }). Géométries et matériaux sont partagés. */
  function create(def) {
    try {
      return buildDeviceModel(def);
    } catch (error) {
      console.warn(`[rendu] modèle réaliste indisponible pour ${def.type} (${def.model || 'par défaut'}) : modèle simplifié.`, error.message || error);
    }
    const model = models.get(def.type);
    return model ? model.clone(true) : createShape(def.type);
  }

  return { load, create, has: (type) => models.has(type) };
}
