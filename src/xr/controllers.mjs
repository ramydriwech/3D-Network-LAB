// Manettes VR : un rayon sort de chaque manette ; la gâchette (« select ») actionne le
// bouton du panneau visé ou sélectionne l'équipement ou le paquet visé.
// La sélection réutilise pick() de l'interface (src/ui/selection.mjs) : la souris, le doigt
// et les manettes partagent donc exactement la même logique.

import * as THREE from 'three';
import { pick } from '../ui/selection.mjs';

const RAY_LENGTH = 6;

/**
 * `rig` fournit getController(i) : renderer.xr (voie « native ») ou les
 * manettes du pont WebGPU (src/xr/gpuBridge.mjs).
 */
export function initControllers(app, panel, rig = app.render.renderer.xr) {
  const { render } = app;
  const xr = rig;
  const presenting = () => render.isPresenting();
  const raycaster = new THREE.Raycaster();
  raycaster.far = 30;
  const rotation = new THREE.Matrix4();

  /** Oriente le rayon selon la manette : origine = sa position, direction = son axe -Z. */
  function aim(controller) {
    rotation.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
  }

  /** Ce que vise la manette : un bouton du panneau, ou un objet de la scène. */
  function target(controller) {
    aim(controller);
    const onPanel = panel.intersect(raycaster);
    if (onPanel) return { kind: 'panel', button: onPanel.button, distance: onPanel.distance };
    // Dans le laboratoire : équipements, étagère « Équipements » (modèles et câbles) et sol (pour se téléporter).
    const lab = render.lab;
    if (lab && lab.inVR) {
      const aimed = lab.aimAt(raycaster.ray.origin, raycaster.ray.direction);
      if (aimed && aimed.kind === 'device') return { kind: 'object', hit: { kind: 'device', id: aimed.id }, aimed, distance: aimed.distance };
      if (aimed) return { kind: aimed.kind, aimed, distance: aimed.distance };
    }
    const hit = pick(render, raycaster);
    if (hit) return { kind: 'object', hit, distance: hit.distance };
    // Tolérance de visée : sur la maquette, un équipement ne fait que quelques centimètres.
    // Si le rayon passe tout près (moins de AIM_TOLERANCE), on le considère comme visé.
    const near = nearestDevice(raycaster.ray);
    return near ? { kind: 'object', hit: near, distance: near.distance } : null;
  }

  const AIM_TOLERANCE = THREE.MathUtils.degToRad(3);
  const toDevice = new THREE.Vector3();
  function nearestDevice(ray) {
    let best = null;
    for (const def of (app.sim.scenario && app.sim.scenario.devices) || []) {
      const object = render.deviceObject(def.id);
      if (!object) continue;
      object.getWorldPosition(toDevice).sub(ray.origin);
      const distance = toDevice.length();
      const angle = toDevice.angleTo(ray.direction);
      if (angle < AIM_TOLERANCE && (!best || angle < best.angle)) best = { kind: 'device', id: def.id, distance, angle, object };
    }
    return best;
  }

  const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const hands = [0, 1].map((index) => {
    const controller = xr.getController(index);
    const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0x7dd3fc }));
    line.scale.z = RAY_LENGTH;
    line.raycast = () => {};
    controller.add(line);
    const onSelect = () => {
      const aimed = target(controller);
      const build = app.labHud && app.labHud.build;
      if (aimed && aimed.kind === 'panel') { if (aimed.button) panel.press(aimed.button); return; }
      // Construire (labBuild.mjs) : les mains pleines, la gâchette pose, installe ou branche ;
      // sur une étagère, elle prend un modèle, un meuble ou un câble.
      if (build && render.lab && render.lab.inVR) {
        const labTarget = aimed ? aimed.aimed || null : null;
        if (build.held || (labTarget && ['catalog', 'furnitureCatalog', 'cable'].includes(labTarget.kind))) {
          build.setVRTarget(labTarget);
          if (build.click(labTarget)) return;
        }
      }
      if (!aimed) return;
      if (aimed.kind === 'floor') {
        render.lab.teleportVR(aimed.aimed.point);
      } else if (aimed.kind === 'catalog') {
        if (app.labHud) app.labHud.addFromCatalog(aimed.aimed.type, aimed.aimed.model);
      } else if (aimed.kind === 'cable') {
        if (app.labHud && app.labHud.pickCable) app.labHud.pickCable(aimed.aimed.cable); // câble des prochains branchements
      } else if (app.selection) {
        app.selection.select(aimed.hit);
      }
    };
    controller.addEventListener('select', onSelect);
    // Poignée latérale (grip) : reprendre ce qui est visé (équipement, meuble), débrancher une
    // prise, ou reposer ce qu'on a en main.
    const onSqueeze = () => {
      const build = app.labHud && app.labHud.build;
      if (!build || !render.lab || !render.lab.inVR) return;
      const aimed = target(controller);
      const labTarget = aimed ? aimed.aimed || null : null;
      build.setVRTarget(labTarget);
      build.grab(labTarget);
    };
    controller.addEventListener('squeeze', onSqueeze);
    render.scene.add(controller);
    return { controller, line, onSelect, onSqueeze };
  });

  // Anneau posé au sol là où l'on va se téléporter.
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.raycast = () => {};
  render.scene.add(marker);
  // Rotation par crans (30°) avec le joystick : on attend qu'il revienne au centre.
  const SNAP = Math.PI / 6;
  const armed = new Map();
  function snapTurn() {
    const session = app.xr && app.xr.session;
    if (!session || !render.lab || !render.lab.inVR) return;
    for (const source of session.inputSources || []) {
      const axes = source.gamepad && source.gamepad.axes;
      if (!axes || axes.length < 2) continue;
      const x = axes.length >= 4 ? axes[2] : axes[0];
      const key = source.handedness || 'none';
      if (Math.abs(x) < 0.3) armed.set(key, true);
      else if (Math.abs(x) > 0.75 && armed.get(key) !== false) {
        armed.set(key, false);
        render.lab.turnVR(x > 0 ? -SNAP : SNAP);
      }
    }
  }
  // À chaque image : le rayon s'arrête sur ce qu'il touche et le bouton visé s'éclaire.
  const offFrame = render.onFrame(() => {
    if (!presenting()) return;
    let hovered = null;
    let floor = null;
    snapTurn();
    const build = app.labHud && app.labHud.build;
    let buildTarget = null;
    for (const hand of hands) {
      const aimed = target(hand.controller);
      // La silhouette de ce que l'on pose suit le rayon de la manette (la droite d'abord).
      if (aimed && aimed.aimed && (!buildTarget || hand === hands[1])) buildTarget = aimed.aimed;
      hand.line.scale.z = aimed ? aimed.distance : RAY_LENGTH;
      hand.line.material.color.setHex(aimed ? 0x4ade80 : 0x7dd3fc);
      if (aimed && aimed.kind === 'panel' && aimed.button) hovered = aimed.button;
      if (aimed && aimed.kind === 'floor' && hand.controller.visible !== false) floor = aimed.aimed.point;
      if (aimed && aimed.kind === 'floor') hand.line.material.color.setHex(0x22d3ee);
      if (aimed && (aimed.kind === 'catalog' || aimed.kind === 'cable')) hand.line.material.color.setHex(0xfbbf24);
    }
    panel.hover(hovered);
    if (build) build.setVRTarget(buildTarget);
    if (build && build.held) floor = null; // les mains pleines, la gâchette pose : pas de téléportation
    marker.visible = !!floor;
    if (floor) marker.position.copy(render.lab.room.localToWorld(floor.clone().setY(0.01)));
  });

  return {
    hands,
    dispose() {
      offFrame();
      render.scene.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
      for (const hand of hands) {
        hand.controller.removeEventListener('select', hand.onSelect);
        hand.controller.removeEventListener('squeeze', hand.onSqueeze);
        hand.controller.remove(hand.line);
        hand.line.material.dispose();
        render.scene.remove(hand.controller);
      }
      lineGeometry.dispose();
    },
  };
}
