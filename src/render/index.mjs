// Rendu 3D — point d'entrée. initRender() crée la scène et retourne l'API de rendu
// (voir api.mjs et docs/api-rendu.md), la seule chose que les autres modules utilisent.

import * as THREE from 'three';
import { Topics } from '../sim/events.mjs';
import { RENDER_API } from './api.mjs';
import { createMockRender } from './mockRender.mjs';
import { createScene } from './scene.mjs';
import { createShape, DEVICE_HEIGHT } from './shapes.mjs';
import { createDeviceFactory } from './factory.mjs';
import { createLink, placeLink, CABLE_HEIGHT } from './links.mjs';
import { fallbackEnd, trayLines } from './cableRoute.mjs';
import { createLabel, updateLabel, resizeLabel } from './labels.mjs';
import { packetStyle, packetColor, legend } from './packetStyles.mjs';
import { baseMac } from '../sim/addr.mjs';
import { addContactShadow, castShadows } from './contactShadow.mjs';

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
/**
 * Mode classique : équipements, câbles, paquets et étiquettes 1,5 fois plus grands par rapport
 * aux distances de la topologie, pour être bien lisibles en vue d'ensemble. Le laboratoire
 * repasse à 1 (tailles réelles : PC sur le bureau, fiches dans les prises).
 */
export const CLASSIC_SCALE = 1.5;

/** Pourquoi WebGPU manque, et que faire (français puis anglais). */
const FAILURE_TEXTS = {
  absent: ['Ce navigateur ne connaît pas WebGPU.', 'This browser does not support WebGPU.'],
  adapter: ['WebGPU est désactivé ou cette carte graphique n\'est pas prise en charge.', 'WebGPU is disabled or this graphics card is not supported.'],
  init: ['WebGPU n\'a pas pu démarrer sur cette carte graphique.', 'WebGPU could not start on this graphics card.'],
};

function showFailure(container, error) {
  const [fr, en] = FAILURE_TEXTS[error && error.reason] || FAILURE_TEXTS.init;
  const box = document.createElement('div');
  box.className = 'scene-error';
  const line = (text, strong = false) => {
    const p = document.createElement('p');
    if (strong) { const b = document.createElement('strong'); b.textContent = text; p.append(b); } else p.textContent = text;
    box.append(p);
  };
  line(`${fr} La scène 3D a besoin de WebGPU.`, true);
  line('Ouvrez l\'application dans Chrome ou Edge (version récente, PC, Mac ou Android), Safari 26 ou plus récent, ou Firefox 141 ou plus récent (Windows). Vérifiez aussi que l\'accélération matérielle est activée et que le pilote graphique est à jour.');
  line(`${en} The 3D scene requires WebGPU: use a recent Chrome or Edge, Safari 26+, or Firefox 141+ (Windows), with hardware acceleration enabled.`);
  container.appendChild(box);
  container.classList.add('no-webgpu'); // sans scène 3D, l'aide de navigation n'a pas de sens
  console.error('[rendu] WebGPU indisponible : la scène 3D ne peut pas s\'afficher', error);
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
  badge.textContent = 'WebGPU';
  badge.title = 'Rendu 100 % WebGPU / 100% WebGPU rendering';
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
  /** Échelle d'affichage des objets (CLASSIC_SCALE en mode classique, 1 dans le labo). */
  let viewScale = CLASSIC_SCALE;
  const linkLabels = [];
  /** Taille d'une étiquette posée dans la scène (hors équipement, qui porte déjà l'échelle). */
  const tagSize = (base) => base * labelSize * viewScale;

  /**
   * Lignes de l'étiquette : le nom, puis l'adresse qui identifie l'équipement.
   *   - PC, serveur, routeur, pare-feu : ses adresses IP (deux au plus, puis « +n ») ;
   *   - switch (couche 2, sans adresse IP) : son adresse MAC de base.
   */
  function labelLines(def) {
    const live = sim.device && sim.device(def.id);
    const interfaces = live ? live.interfaces : def.interfaces || [];
    const lines = [def.name];
    if (def.type === 'switch') {
      lines.push(baseMac(def));
      return lines;
    }
    const addresses = interfaces.filter((it) => it.ip).map((it) => `${it.ip}/${it.prefix}`);
    if (!addresses.length) lines.push('— (IP ?)');
    else if (addresses.length <= 2) lines.push(...addresses);
    else lines.push(addresses[0], `${addresses[1]}  +${addresses.length - 2}`);
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
      // Le modèle peut être tourné (équipement installé dans une baie tournée, laboratoire).
      const q = object.quaternion;
      const point = local.clone().multiplyScalar(object.scale.x).applyQuaternion(q).add(object.position);
      const out = new THREE.Vector3(0, 0, spec && spec.face === 'back' ? -1 : 1).applyQuaternion(q);
      // Chemins de câbles (laboratoire) : depuis une baie, le cordon longe la façade jusqu'au
      // bord le plus proche de sa destination, puis monte sur le côté (il ne cache pas l'équipement).
      if (routing.mode === 'tray' && layout && layout.type !== 'host') {
        const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q); // largeur de l'équipement
        const side = Math.sign(other.clone().sub(object.position).dot(across)) || 1;
        const shift = side * (layout.width * object.scale.x / 2 + 0.16) - point.clone().sub(object.position).dot(across);
        const rise = point.clone().addScaledVector(across, shift).addScaledVector(out, 0.3);
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
      tag.position.set(point.x, point.y + 0.32 * viewScale, point.z);
    }
  }

  // Tracé des câbles : au sol (vue classique) ou par les chemins de câbles du plafond (laboratoire).
  let routing = { mode: 'floor' };
  /** Tracé d'un câble : en mode chemins, chaque câble est un peu décalé (nappe de câbles). */
  function routingFor(index) {
    return routing.mode === 'tray' ? { ...routing, offset: ((index % 7) - 3) * 0.06, scale: viewScale } : { ...routing, scale: viewScale };
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
      const pose = placement ? placement(def) : null; // laboratoire : place sur son meuble
      if (pose) { object.position.set(...pose.position); object.rotation.set(0, pose.rotation, 0); }
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
      object.scale.setScalar(viewScale); // l'étiquette, l'anneau et l'ombre suivent
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
        const tag = createLabel([port], { size: tagSize(0.5), background: 'rgba(30, 41, 59, 0.9)' });
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
    for (const tag of linkLabels) resizeLabel(tag, tagSize(tag.userData.base));
  }

  /**
   * Placement des équipements par un autre module (le laboratoire : chaque équipement sur son
   * meuble). `fn(def)` → { position: [x, y, z] (repère de la topologie), rotation (radians) } ou
   * null (position du scénario). null : retour aux positions du scénario (mode classique).
   */
  let placement = null;
  function setPlacement(fn) {
    placement = fn || null;
    for (const entry of devices.values()) {
      const pose = placement ? placement(entry.def) : null;
      if (pose) { entry.object.position.set(...pose.position); entry.object.rotation.set(0, pose.rotation, 0); }
      else { entry.object.position.set(...entry.def.position); entry.object.rotation.set(0, 0, 0); }
    }
    updateLinks(null);
    shadowSignature = NaN;
  }

  /** Cadre la caméra de survol sur toute la topologie. */
  function frameTopology() {
    const box = new THREE.Box3();
    for (const entry of devices.values()) box.expandByPoint(entry.object.position);
    if (!box.isEmpty()) stage.frame(box);
  }

  // --- Ombres portées : la carte d'ombre est figée (scene.mjs) ; on la recalcule seulement
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
    add(viewScale);
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
    /** Taille des étiquettes posées dans la scène (câbles, charge) : réglage du labo/VR × échelle d'affichage. */
    get labelSize() { return labelSize * viewScale; },
    /** Échelle d'affichage des objets : CLASSIC_SCALE en mode classique, 1 dans le laboratoire. */
    get viewScale() { return viewScale; },
    /** Échelle d'affichage du mode classique (CLASSIC_SCALE). */
    classicScale: CLASSIC_SCALE,
    /**
     * Change l'échelle d'affichage : équipements, câbles (épaisseur, connecteurs), paquets et
     * étiquettes grossissent par rapport aux distances de la topologie, qui ne changent pas.
     */
    setViewScale(scale) {
      viewScale = scale > 0 ? scale : 1;
      for (const entry of devices.values()) entry.object.scale.setScalar(viewScale);
      for (const tag of linkLabels) resizeLabel(tag, tagSize(tag.userData.base));
      updateLinks(null);
      shadowSignature = NaN;
    },
    /** Recadre la caméra de survol sur toute la topologie (retour au mode classique). */
    frameTopology,
    /** Place les équipements (laboratoire) : voir setPlacement ci-dessus. */
    setPlacement,
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
      // boucle continue dans le casque pendant une session WebXR (voie « native »).
      renderer.setAnimationLoop(mainLoop);
    },
    /**
     * Une image : simulation, modules abonnés, puis dessin par `draw`. Utilisé par la boucle
     * normale et par la boucle VR du pont WebGPU (src/xr/gpuBridge.mjs), qui dessine pour
     * deux yeux.
     */
    runFrame(time, draw) {
      // Un onglet resté en arrière-plan ne doit pas provoquer un saut de plusieurs secondes.
      const dt = lastTime === null ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      if (loopTick) loopTick(dt);
      for (const callback of frameCallbacks) callback(dt);
      // Vue à la première personne (laboratoire) : la caméra est pilotée par src/render/lab.mjs.
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
    /** Qualité : { setting: 'auto'|'low'|'high', level et auto: 'low'|'high' } (quality.mjs). */
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
      for (const tag of linkLabels) resizeLabel(tag, tagSize(tag.userData.base));
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

  // L'animation des paquets est un module à part (packetAnimator.mjs) : s'il n'est pas
  // encore là, la scène s'affiche quand même.
  try {
    const { createPacketAnimator } = await import('./packetAnimator.mjs');
    createPacketAnimator(render, sim);
  } catch (error) {
    console.warn('[rendu] animation des paquets indisponible', error.message || error);
  }
  try {
    const { createLinkLoad } = await import('./linkLoad.mjs');
    render.linkLoad = createLinkLoad(render, sim);
  } catch (error) {
    console.warn('[rendu] charge des liens indisponible', error.message || error);
  }
  try {
    const { createPortLeds } = await import('./portLeds.mjs');
    render.portLeds = createPortLeds(render, sim);
  } catch (error) {
    console.warn('[rendu] voyants des ports indisponibles', error.message || error);
  }
  try {
    const { createLab } = await import('./lab.mjs');
    render.lab = createLab(render, sim);
  } catch (error) {
    console.warn('[rendu] laboratoire indisponible', error.message || error);
  }
  if (sim.scenario) showTopology(sim.scenario);
  return render;
}
