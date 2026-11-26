// Déplacement des équipements à la souris ou au doigt (éditeur, demande du superviseur).
//
// Actif seulement quand l'éditeur le demande (options.enabled()). On attrape un équipement,
// on le fait glisser sur le sol (plan y = 0) ; les câbles qui y sont branchés suivent en
// direct. Au relâchement, options.onDrop(id, [x, 0, z]) prévient l'éditeur, qui enregistre
// la nouvelle position. Pendant le glissement, la rotation de la caméra est suspendue.

import * as THREE from 'three';

/** Déplacement (px) à partir duquel un appui devient un glissement (sinon c'est un clic). */
const DRAG_THRESHOLD = 6;

export function createDragControls(render, sim, options) {
  const canvas = render.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let drag = null; // { id, object, start: {x, y}, offset, moved, pointerId }

  function ray(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, render.camera);
  }

  /** Point du sol sous le pointeur, en coordonnées de la topologie (repère de `world`). */
  function groundPoint(event) {
    ray(event);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    return render.world.worldToLocal(hit.clone());
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!options.enabled() || render.vrMode || event.button > 0) return;
    ray(event);
    const hits = raycaster.intersectObjects(render.pickables(), true);
    for (const item of hits) {
      let object = item.object;
      while (object && !(object.userData && object.userData.kind === 'device')) object = object.parent;
      if (!object) continue;
      const point = groundPoint(event);
      if (!point) return;
      drag = {
        id: object.userData.id, object, start: { x: event.clientX, y: event.clientY },
        offset: object.position.clone().sub(point).setY(0), moved: false, pointerId: event.pointerId,
      };
      render.controls.enabled = false; // la caméra ne tourne pas pendant le glissement
      return;
    }
  }, { capture: true });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_THRESHOLD) return;
    drag.moved = true;
    canvas.style.cursor = 'grabbing';
    const point = groundPoint(event);
    if (!point) return;
    drag.object.position.set(point.x + drag.offset.x, drag.object.position.y, point.z + drag.offset.z);
    render.updateLinks(drag.id); // les câbles suivent, branchés dans leurs prises
  });

  function end(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const done = drag;
    drag = null;
    render.controls.enabled = true;
    canvas.style.cursor = '';
    if (done.moved) options.onDrop(done.id, [done.object.position.x, 0, done.object.position.z]);
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    get dragging() { return !!(drag && drag.moved); },
  };
}
