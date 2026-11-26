// Rendu 3D — point d'entrée. initRender() crée la scène et retourne l'API de rendu
// (voir api.js et docs/api-rendu.md), la seule chose que les autres modules utilisent.

import * as THREE from 'three';
import { Topics } from '../sim/events.js';
import { RENDER_API } from './api.js';
import { createMockRender } from './mockRender.js';
import { createScene } from './scene.js';
import { createShape, DEVICE_HEIGHT } from './shapes.js';
import { createDeviceFactory } from './factory.js';
import { createLink, placeLink, CABLE_HEIGHT } from './links.js';
import { fallbackEnd, trayLines } from './cableRoute.js';
import { createLabel, updateLabel, resizeLabel } from './labels.js';
import { packetStyle, packetColor, legend } from './packetStyles.js';
import { addContactShadow, castShadows } from './contactShadow.js';

export { RENDER_API };

/** Hauteur à laquelle les paquets voyagent au-dessus des câbles. */
const PACKET_HEIGHT = 0.75;
const SELECTION_COLORS = [0x38bdf8, 0x4ade80]; // 1er sélectionné : bleu ; 2e : vert
/** Largeur visée de la topologie en VR, en mètres : elle tient sur une table devant soi. */
const VR_WIDTH = 1.8;
const VR_POSITION = new THREE.Vector3(0, 0.85, -1.5);
/** Au-delà, les paquets supplémentaires ne sont pas dessinés (fluidité sur mobile). */
const MAX_PACKETS_MOBILE = 16;
const MAX_PACKETS_DESKTOP = 48;

function showFailure(container, error) {
  const box = document.createElement('p');
  box.className = 'scene-error';
  box.textContent = 'Ni WebGPU ni WebGL 2 ne sont disponibles sur cet appareil : la scène 3D ne peut pas s\'afficher. '
    + 'Neither WebGPU nor WebGL 2 is available on this device: the 3D scene cannot be displayed.';
  container.appendChild(box);
  console.error('[rendu] initialisation impossible', error);
}

/**
 * @param {Object} options
 * @param {HTMLElement} options.container  élément qui reçoit le canevas (#scene)
 * @param {Object} options.sim             simulation (réelle ou mock) : on(), now, device()
 */
export async function initRender({ container, sim }) {
  let stage;
  try {
    stage = await createScene(container);
  } catch (error) {
    showFailure(container, error);
    return createMockRender();
  }
  const { renderer, scene, camera, controls, world } = stage;

  // Pastille discrète dans un coin de la scène : quel moteur dessine l'image.
  const badge = document.createElement('span');
  badge.className = 'backend-badge';
  badge.dataset.backend = stage.backend;
  badge.textContent = stage.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
  badge.title = 'Moteur de rendu utilisé / Rendering backend in use';
  container.appendChild(badge);

  const linksLayer = new THREE.Group();
  const devicesLayer = new THREE.Group();
  const packetLayer = new THREE.Group();
  world.add(linksLayer, devicesLayer, packetLayer);

  const devices = new Map(); // id -> { def, object, ring, label }
  const linkMeshes = new Map(); // id du lien -> câble 3D
  const frameCallbacks = new Set();
  let loopTick = null;
  let lastTime = null;
  const mainLoop = (time) => render.runFrame(time, () => renderer.render(scene, camera));
  const ringGeometry = new THREE.RingGeometry(1.05, 1.25, 40);
  ringGeometry.rotateX(-Math.PI / 2);
  const factory = createDeviceFactory();
  await factory.load();
  let labelSize = 1;
  const linkLabels = [];

  /** Lignes de l'étiquette : le nom, puis l'adresse IP d'un PC ou d'un serveur. */
  function labelLines(def) {
    const live = sim.device && sim.device(def.id);
    const interfaces = live ? live.interfaces : def.interfaces || [];
    const lines = [def.name];
    if (def.type === 'host' || def.type === 'server') {
      const iface = interfaces.find((it) => it.ip);
      lines.push(iface ? `${iface.ip}/${iface.prefix}` : '— (IP ?)');
    }
    return lines;
  }

  function clearLayer(layer) {
    while (layer.children.length) layer.remove(layer.children[0]);
  }

  /**
   * Extrémité d'un câble : la prise `port` de l'équipement (point de branchement fourni par
   * son modèle 3D) et sa direction de sortie ; à défaut, le bord de l'équipement côté `otherId`.
   */
  function cableEnd(deviceId, port, otherId) {
    const object = devices.get(deviceId).object;
    const other = devices.get(otherId) ? devices.get(otherId).object.position : object.position;
    const local = object.userData.ports && object.userData.ports[port];
    if (local) {
      const layout = object.userData.layout;
      const spec = layout && layout.ports.find((p) => p.name === port);
      const point = local.clone().add(object.position);
      const out = new THREE.Vector3(0, 0, spec && spec.face === 'back' ? -1 : 1);
      // Chemins de câbles (laboratoire) : depuis une baie, le cordon longe la façade jusqu'au
      // bord le plus proche de sa destination, puis monte sur le côté (il ne cache pas l'équipement).
      if (routing.mode === 'tray' && layout && layout.type !== 'host') {
        const side = Math.sign(other.x - object.position.x) || 1;
        const rise = new THREE.Vector3(object.position.x + side * (layout.width / 2 + 0.16), point.y, point.z + out.z * 0.3);
        return { point, out, rise };
      }
      return { point, out };
    }
    const end = fallbackEnd(object.position.toArray(), other.toArray(), CABLE_HEIGHT);
    return { point: new THREE.Vector3(...end.point), out: new THREE.Vector3(...end.out) };
  }

  /** Étiquettes de ports : un peu le long du câble, au-dessus, pour qu'elles s'écartent. */
  function placePortTags(cable) {
    const { curve, length, tags } = cable.userData;
    for (const tag of tags || []) {
      const t = Math.min(0.35, 0.9 / Math.max(length, 0.1));
      const point = curve.getPointAt(tag.userData.end === 0 ? t : 1 - t);
      tag.position.set(point.x, point.y + 0.32, point.z);
    }
  }

  // Tracé des câbles : au sol (vue classique) ou par les chemins de câbles du plafond (laboratoire).
  let routing = { mode: 'floor' };
  /** Tracé d'un câble : en mode chemins, chaque câble est un peu décalé (nappe de câbles). */
  function routingFor(index) {
    return routing.mode === 'tray' ? { ...routing, offset: ((index % 7) - 3) * 0.06 } : routing;
  }

  /** Retrace les câbles d'un équipement qu'on déplace (éditeur, glisser-déposer), ou tous les câbles. */
  function updateLinks(deviceId = null) {
    let index = 0;
    for (const cable of linkMeshes.values()) {
      const { a, b, id } = cable.userData;
      const mine = deviceId === null || a === deviceId || b === deviceId;
      const link = mine && (sim.scenario.links || []).find((item) => item.id === id);
      if (link) {
        placeLink(cable, cableEnd(a, link.a.split(':')[1], b), cableEnd(b, link.b.split(':')[1], a), routingFor(index));
        placePortTags(cable);
      }
      index += 1;
    }
  }

  function showTopology(scenario) {
    clearLayer(linksLayer);
    clearLayer(devicesLayer);
    clearLayer(packetLayer);
    devices.clear();
    linkLabels.length = 0;
    linkMeshes.clear();
    const box = new THREE.Box3();

    for (const def of scenario.devices) {
      const object = factory.create(def);
      object.position.set(def.position[0], def.position[1], def.position[2]);
      // Fusion (et non remplacement) : le modèle porte aussi ses ports et ses voyants.
      Object.assign(object.userData, { kind: 'device', id: def.id });
      // Hauteur réelle du modèle, pour poser l'étiquette juste au-dessus.
      const top = new THREE.Box3().setFromObject(object).max.y - object.position.y;
      // Ombres : portées (qualité haute) et de contact (toujours), avant étiquette et anneau.
      castShadows(object);
      addContactShadow(object);
      const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: SELECTION_COLORS[0], transparent: true, opacity: 0.9, toneMapped: false }));
      ring.position.y = 0.03;
      ring.visible = false;
      ring.raycast = () => {};
      object.add(ring);
      const entry = { def, object, ring, label: null };
      entry.label = createLabel(labelLines(def), { size: labelSize });
      entry.label.position.y = (Number.isFinite(top) ? top : DEVICE_HEIGHT[def.type] || 1) + 0.6;
      object.add(entry.label);
      devicesLayer.add(object);
      devices.set(def.id, entry);
      box.expandByPoint(object.position);
    }

    for (const link of scenario.links || []) {
      const [aId, aPort] = link.a.split(':');
      const [bId, bPort] = link.b.split(':');
      const cable = createLink(cableEnd(aId, aPort, bId), cableEnd(bId, bPort, aId), link.cable, routingFor(linkMeshes.size));
      Object.assign(cable.userData, { id: link.id, a: aId, b: bId, tags: [] });
      linksLayer.add(cable);
      linkMeshes.set(link.id, cable);
      // Nom du port à chaque extrémité côté switch, routeur ou pare-feu : utile pour lire les tables.
      for (const [id, port, end] of [[aId, aPort, 0], [bId, bPort, 1]]) {
        const type = devices.get(id).def.type;
        if (type !== 'switch' && type !== 'router' && type !== 'firewall') continue;
        const tag = createLabel([port], { size: 0.5 * labelSize, background: 'rgba(30, 41, 59, 0.9)' });
        tag.userData.base = 0.5;
        tag.userData.end = end;
        cable.userData.tags.push(tag);
        linksLayer.add(tag);
        linkLabels.push(tag);
      }
      placePortTags(cable);
    }

    // Dans l'éditeur, la caméra ne bouge pas à chaque modification (render.keepCamera).
    if (!box.isEmpty() && !render.keepCamera) stage.frame(box);
  }

  function highlight(ids = []) {
    for (const [id, entry] of devices) {
      const rank = ids.indexOf(id);
      entry.ring.visible = rank !== -1;
      if (rank !== -1) entry.ring.material.color.setHex(SELECTION_COLORS[Math.min(rank, 1)]);
    }
  }

  /** Point où un paquet quitte ou atteint un équipement (coordonnées de `world`). */
  function anchor(deviceId) {
    const entry = devices.get(deviceId);
    const position = entry ? entry.object.position : new THREE.Vector3();
    return new THREE.Vector3(position.x, PACKET_HEIGHT, position.z);
  }

  // --- Mode VR : la topologie devient une maquette posée devant l'utilisateur.
  let vrMode = false;
  function setVRMode(enabled) {
    vrMode = enabled;
    if (enabled) {
      const box = new THREE.Box3();
      for (const entry of devices.values()) box.expandByPoint(entry.object.position);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = VR_WIDTH / Math.max(size.x, size.z, 1);
      world.scale.setScalar(scale);
      world.position.copy(VR_POSITION).sub(center.multiplyScalar(scale));
      world.position.y = VR_POSITION.y;
    } else {
      world.scale.setScalar(1);
      world.position.set(0, 0, 0);
    }
    stage.grid.visible = !enabled; // la grille de 60 m n'a pas de sens sur une maquette
    // Les étiquettes rétrécissent avec la maquette : on les agrandit pour qu'elles
    // restent lisibles à un mètre de distance.
    labelSize = enabled ? 1.7 : 1;
    for (const entry of devices.values()) resizeLabel(entry.label, labelSize);
    for (const tag of linkLabels) resizeLabel(tag, tag.userData.base * labelSize);
  }

  // --- Ombres portées : la carte d'ombre est figée (scene.js) ; on la recalcule seulement
  // quand quelque chose bouge : topologie, glisser-déposer, laboratoire, VR, téléportation.
  // Une empreinte numérique de la scène, comparée à chaque image, suffit à le détecter.
  // WebGPU prépare ses programmes de dessin en arrière-plan, parfois pendant plusieurs
  // secondes : un objet tout neuf peut manquer à une carte d'ombre. On la recalcule donc aussi,
  // par sécurité, toutes les SHADOW_REFRESH ms réelles (une passe toutes les ~30 images).
  const SHADOW_REFRESH = 500;
  const shadowRoots = new Set(); // autres groupes qui portent des ombres (salle du labo)
  let shadowSignature = NaN;
  let shadowClock = 0;
  function shadowState() {
    let signature = 0;
    let weight = 1;
    const add = (value) => { signature += value * weight; weight = (weight * 1.618) % 97 + 1; };
    world.updateWorldMatrix(true, false);
    for (const value of world.matrixWorld.elements) add(value);
    add(devicesLayer.children.length);
    for (const child of devicesLayer.children) { add(child.position.x); add(child.position.z); }
    for (const root of shadowRoots) {
      add(root.visible ? 1 : 2);
      if (!root.visible) continue;
      root.updateWorldMatrix(true, false);
      for (const value of root.matrixWorld.elements) add(value);
    }
    return signature;
  }
  function trackShadows(dt) {
    const signature = shadowState();
    if (signature === shadowSignature) {
      shadowClock += dt;
      if (shadowClock >= SHADOW_REFRESH) { shadowClock = 0; stage.invalidateShadows(); }
      return;
    }
    shadowSignature = signature;
    shadowClock = 0;
    const box = new THREE.Box3();
    box.expandByObject(devicesLayer);
    box.expandByObject(linksLayer);
    for (const root of shadowRoots) if (root.visible) box.expandByObject(root);
    stage.fitShadows(box);
  }

  const render = {
    scene,
    camera,
    renderer,
    backend: stage.backend,
    domElement: renderer.domElement,
    controls,
    world,
    packetLayer,
    maxPackets: (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? MAX_PACKETS_MOBILE : MAX_PACKETS_DESKTOP,
    showTopology,
    anchor,
    deviceObject: (id) => (devices.has(id) ? devices.get(id).object : null),
    linkObject: (id) => linkMeshes.get(id) || null,
    /**
     * Trajet d'un câble pour les paquets : { curve, start } — curve va de l'équipement `start`
     * (côté « a » du lien dans le scénario) à l'autre ; null si le lien n'existe pas.
     */
    linkPath(id) {
      const cable = linkMeshes.get(id);
      return cable ? { curve: cable.userData.curve, start: cable.userData.a, length: cable.userData.length } : null;
    },
    /** Retrace les câbles d'un équipement déplacé (glisser-déposer de l'éditeur). */
    updateLinks,
    /**
     * Tracé des câbles : { mode: 'floor' } (au sol, vue classique) ou { mode: 'tray', height }
     * (chemins de câbles à la hauteur `height`, repère de la topologie : laboratoire). Retrace tout.
     */
    setCableRouting(next) {
      routing = next && next.mode === 'tray' ? { mode: 'tray', height: next.height } : { mode: 'floor' };
      updateLinks(null);
    },
    /** Chemins de câbles empruntés par les câbles (mode 'tray') : [{ axis, at, from, to }], repère de la topologie. */
    cableTrays: () => trayLines([...linkMeshes.values()].flatMap((cable) => cable.userData.traySegments || [])),
    /** Recadre la caméra si un équipement est sorti du champ (éditeur). Retourne vrai si recadré. */
    ensureVisible() {
      const box = new THREE.Box3();
      for (const entry of devices.values()) box.expandByPoint(entry.object.position);
      if (box.isEmpty()) return false;
      camera.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const margin = new THREE.Vector3(1.5, 0, 1.5);
      const inside = [...devices.values()].every((entry) => {
        const p = entry.object.getWorldPosition(new THREE.Vector3());
        return frustum.containsPoint(p.clone().add(margin)) && frustum.containsPoint(p.clone().sub(margin));
      });
      if (inside) return false;
      stage.frame(box);
      return true;
    },
    linkLabels, // étiquettes des câbles : agrandies avec les autres en VR
    linksLayer,
    get labelSize() { return labelSize; },
    pickables: () => [devicesLayer, packetLayer],
    highlight,
    makeLabel: (lines, options) => createLabel(lines, options),
    packetStyle,
    packetColor,
    legend,
    setVRMode,
    get vrMode() { return vrMode; },
    resize: stage.resize,
    onFrame(callback) {
      frameCallbacks.add(callback);
      return () => frameCallbacks.delete(callback);
    },
    /** Lance la boucle : `tick(dtMs)` fait avancer la simulation, puis l'image est dessinée. */
    start(tick) {
      loopTick = tick;
      // setAnimationLoop (et non requestAnimationFrame) : obligatoire pour que la même
      // boucle continue dans le casque pendant une session WebXR (voies « native » et « webgl »).
      renderer.setAnimationLoop(mainLoop);
    },
    /**
     * Une image : simulation, modules abonnés, puis dessin par `draw`. Utilisé par la boucle
     * normale et par la boucle VR du pont WebGPU (src/xr/gpuBridge.js), qui dessine pour
     * deux yeux.
     */
    runFrame(time, draw) {
      // Un onglet resté en arrière-plan ne doit pas provoquer un saut de plusieurs secondes.
      const dt = lastTime === null ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      if (loopTick) loopTick(dt);
      for (const callback of frameCallbacks) callback(dt);
      // Vue à la première personne (laboratoire) : la caméra est pilotée par src/render/lab.js.
      if (!render.isPresenting() && !render.manualCamera) controls.update();
      trackShadows(dt);
      draw();
    },
    /** Suspend / reprend la boucle normale (le pont VR prend le relais pendant la session). */
    pauseLoop() { renderer.setAnimationLoop(null); },
    resumeLoop() { lastTime = null; renderer.setAnimationLoop(mainLoop); },
    /** Vrai pendant une session VR, quelle que soit la voie utilisée. */
    isPresenting() { return renderer.xr.isPresenting || render.bridgePresenting === true; },
    bridgePresenting: false,
    /** Vrai quand un module (le laboratoire) pilote lui-même la caméra. */
    manualCamera: false,
    grid: stage.grid,
    /** Cadre la caméra de survol sur une boîte (coordonnées de la scène). */
    frameBox: (box) => stage.frame(box),
    /** Nouveau modèle 3D d'un équipement (GLB ou forme simple), hors topologie. */
    createDeviceModel: (def) => factory.create(def),
    /** Qualité : { setting: 'auto'|'low'|'high', level et auto: 'low'|'high' } (quality.js). */
    get quality() { return stage.quality; },
    /** Change la qualité ('auto', 'low' ou 'high') et la mémorise ; retourne { setting, level }. */
    setQuality(setting) {
      const quality = stage.applyQuality(setting, { remember: true });
      shadowSignature = NaN;
      return quality;
    },
    /** Ambiance lumineuse : 'studio' (vue classique) ou 'lab' (salle du laboratoire). */
    setAmbience(kind) {
      stage.setAmbience(kind);
      shadowSignature = NaN;
    },
    /** Groupes supplémentaires qui portent des ombres (la salle du laboratoire). */
    shadowRoots,
    /** Force le recalcul des ombres portées à la prochaine image. */
    invalidateShadows: () => { shadowSignature = NaN; },
    /** Taille des étiquettes (1 : normale). Le laboratoire les réduit un peu. */
    setLabelScale(size) {
      labelSize = size;
      for (const entry of devices.values()) resizeLabel(entry.label, labelSize);
      for (const tag of linkLabels) resizeLabel(tag, tag.userData.base * labelSize);
    },
  };
  for (const name of RENDER_API) {
    if (!(name in render)) throw new Error(`API de rendu incomplète : « ${name} » manque`);
  }

  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => showTopology(scenario));
  // Une adresse a changé (DHCP) ou tout est réinitialisé : les étiquettes suivent.
  const refreshLabels = () => {
    for (const entry of devices.values()) updateLabel(entry.label, labelLines(entry.def));
  };
  sim.on(Topics.DEVICE_UPDATE, ({ what }) => { if (what === 'ip') refreshLabels(); });
  sim.on(Topics.RESET, refreshLabels);

  // L'animation des paquets est un module à part (packetAnimator.js) : s'il n'est pas
  // encore là, la scène s'affiche quand même.
  try {
    const { createPacketAnimator } = await import('./packetAnimator.js');
    createPacketAnimator(render, sim);
  } catch (error) {
    console.warn('[rendu] animation des paquets indisponible', error.message || error);
  }
  try {
    const { createLinkLoad } = await import('./linkLoad.js');
    render.linkLoad = createLinkLoad(render, sim);
  } catch (error) {
    console.warn('[rendu] charge des liens indisponible', error.message || error);
  }
  try {
    const { createPortLeds } = await import('./portLeds.js');
    render.portLeds = createPortLeds(render, sim);
  } catch (error) {
    console.warn('[rendu] voyants des ports indisponibles', error.message || error);
  }
  try {
    const { createLab } = await import('./lab.js');
    render.lab = createLab(render, sim);
  } catch (error) {
    console.warn('[rendu] laboratoire indisponible', error.message || error);
  }
  if (sim.scenario) showTopology(sim.scenario);
  return render;
}
