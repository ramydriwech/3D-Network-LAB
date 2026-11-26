// Sélection d'un objet 3D au clic ou au toucher.
//
// pick() est la fonction commune : elle reçoit un rayon déjà orienté et retourne l'objet
// touché. La souris, le doigt et les manettes VR (src/xr/controllers.js) l'utilisent tous.

import * as THREE from 'three';
import { Topics } from '../sim/events.js';

/** Déplacement maximal (px) entre l'appui et le relâchement pour compter comme un clic. */
const CLICK_TOLERANCE = 6;

/**
 * Premier objet sélectionnable touché par le rayon.
 * @param {Object} render       API de rendu (pickables())
 * @param {THREE.Raycaster} raycaster  rayon déjà positionné
 * @returns {{kind: 'device', id: string}|{kind: 'packet', packet: Object}|null}
 */
export function pick(render, raycaster) {
  const hits = raycaster.intersectObjects(render.pickables(), true);
  for (const hit of hits) {
    // On remonte jusqu'au parent qui porte userData.kind (un modèle a plusieurs pièces).
    for (let object = hit.object; object; object = object.parent) {
      const data = object.userData;
      if (data && data.kind === 'device') return { kind: 'device', id: data.id, distance: hit.distance, object };
      if (data && data.kind === 'packet') return { kind: 'packet', packet: data.packet, distance: hit.distance, object };
    }
  }
  return null;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** Objet sous un point de l'écran (coordonnées clientX/clientY d'un évènement). */
export function pickAt(render, clientX, clientY) {
  const rect = render.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, render.camera);
  return pick(render, raycaster);
}

/**
 * Mémorise la sélection et la publie sur le bus (Topics.SELECT).
 * Deux équipements restent mis en évidence : le précédent (source d'un éventuel ping)
 * et le courant (destination).
 */
export function createSelection(app) {
  const { sim, render } = app;
  const state = { current: null, previous: null, packet: null };

  function publish(payload) {
    render.highlight([state.previous, state.current].filter(Boolean));
    sim.bus.emit(Topics.SELECT, payload);
  }

  const selection = {
    state,
    /** Applique le résultat de pick() (ou null pour tout désélectionner). */
    select(hit) {
      if (!hit) {
        state.current = null;
        state.previous = null;
        state.packet = null;
        publish({ kind: null });
      } else if (hit.kind === 'device') {
        if (hit.id !== state.current) {
          state.previous = state.current;
          state.current = hit.id;
        }
        publish({ kind: 'device', id: state.current, previous: state.previous });
      } else if (hit.kind === 'packet') {
        state.packet = hit.packet;
        publish({ kind: 'packet', packet: hit.packet });
      }
    },
  };
  sim.on(Topics.SCENARIO_LOADED, () => selection.select(null));
  return selection;
}

export function initSelection(app) {
  const selection = createSelection(app);
  app.selection = selection;
  const canvas = app.render.domElement;
  if (!canvas) return selection; // rendu indisponible (mock)

  // Un clic = appui puis relâchement presque au même endroit. Sinon, c'est une rotation
  // de la caméra et il ne faut rien sélectionner.
  let down = null;
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!down || down.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved <= CLICK_TOLERANCE) selection.select(pickAt(app.render, event.clientX, event.clientY));
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  return selection;
}
