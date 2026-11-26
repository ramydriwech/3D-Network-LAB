// Câbles vivants : passage des paquets et charge des liens.
//
//   - PASSAGE : pendant qu'un paquet traverse un câble, une lueur légère de la couleur de SON
//     protocole court le long du câble, dans son sens. Elle reste transparente et plus fine que
//     le point lumineux du paquet (packetAnimator.mjs), qu'elle ne masque jamais. Elle s'éteint
//     quand le paquet est arrivé.
//   - CHARGE (demande du superviseur : débit et bande passante) : taux d'utilisation du lien sur
//     les dernières secondes. Au-delà de 50 %, une étiquette « Charge 72 % » apparaît au milieu
//     du câble, orange ; au-delà de 80 %, rouge.
//   - TYPE ET VITESSE : chaque câble porte une étiquette « Cat 6 · 1 Gb/s » (vitesse RÉELLE du
//     lien, négociée). Orange avec « bridé par … » quand une carte ou le câble limite le lien :
//     celles-là restent toujours visibles. Les autres, grises et discrètes, n'apparaissent que
//     sur les câbles proches de la caméra, sur ceux de l'équipement sélectionné, et partout
//     dans l'onglet Construire (setShowAll).
//   - Câble COUPÉ (shutdown, err-disabled) : gaine rouge sombre. Le diagnostic peut faire
//     clignoter des câbles en magenta.
//
// Tout suit l'horloge SIMULÉE : en pause, la lueur se fige ; à ×4, elle court quatre fois plus vite.

import * as THREE from 'three';
import { Topics } from '../sim/events.mjs';

import { loadLevel } from '../sim/traffic.mjs';
import { CABLE_RADIUS, cableTagLines } from './cableRoute.mjs';
import { updateLabel } from './labels.mjs';

/** Couleurs des niveaux de charge (étiquette « Charge … % »). */
export const LOAD_COLORS = Object.freeze({
  idle: 0x64748b,
  low: 0x22c55e,
  busy: 0xf59e0b,
  saturated: 0xef4444,
});
const LOAD_BACKGROUNDS = Object.freeze({ busy: 'rgba(180, 83, 9, 0.94)', saturated: 'rgba(185, 28, 28, 0.94)' });
/** Câble coupé : une des deux interfaces est éteinte (shutdown) ou bloquée (err-disabled). */
const DOWN_COLOR = 0x7f1d1d;
const FLASH_COLOR = 0xd946ef;
/** Fréquence de mise à jour de la charge (ms réelles) : inutile de recalculer à chaque image. */
const REFRESH = 150;
/** Longueur d'un motif de la lueur le long du câble (unités de la scène). */
const DASH = 0.5;
/** Opacité de la lueur de passage : assez pour voir le protocole, assez peu pour voir le point. */
const PASSAGE_OPACITY = 0.4;
/** Après l'arrivée d'un paquet, la lueur s'éteint en douceur (ms simulées). */
const FADE_OUT = 200;
/** Étiquettes grises : visibles jusqu'à cette distance de la caméra (unités de la topologie). */
const TAG_DISTANCE = 7;

/** Le lien est-il coupé ? */
function isDown(sim, link) {
  if (!link) return false;
  return [link.a, link.b].some((end) => {
    const device = end && sim.device(end.device);
    return !!(device && device.isDown && device.isDown(end.iface));
  });
}

/** Motif de la lueur, en transparence : un trait aux bords adoucis, puis un vide (noir = transparent). */
let dashImage = null;
function dashTexture() {
  if (!dashImage) {
    dashImage = document.createElement('canvas');
    dashImage.width = 128;
    dashImage.height = 4;
    const g = dashImage.getContext('2d');
    const gradient = g.createLinearGradient(0, 0, 128, 0);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.4, '#ffffff');
    gradient.addColorStop(0.65, '#ffffff');
    gradient.addColorStop(1, '#000000');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 4);
  }
  const texture = new THREE.CanvasTexture(dashImage); // une texture par câble : décalage propre
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

const language = () => ((globalThis.document && document.documentElement.lang) === 'en' ? 'en' : 'fr');

export function createLinkLoad(render, sim) {
  const state = new Map(); // id du lien -> { cable, glow, tag, loadTag, load, level, down }
  const passages = new Map(); // id du lien -> { color, start, end, direction } (dernier paquet émis)
  let elapsed = REFRESH;
  let lastSimNow = 0;
  let flashing = { ids: new Set(), left: 0 }; // câbles montrés par le diagnostic
  let showAll = false; // onglet Construire : toutes les étiquettes de câbles
  let selected = null; // équipement sélectionné : ses câbles montrent leur étiquette
  const eye = new THREE.Vector3();
  const spot = new THREE.Vector3();

  /** Étiquette « Cat 6 · 1 Gb/s » du câble (orange et « bridé par … » si le lien est bridé). */
  function cableTag(def, link) {
    if (!render.makeLabel || !link) return null;
    const nameOf = (end) => {
      const id = String(end || '').split(':')[0];
      const device = (sim.scenario.devices || []).find((d) => d.id === id);
      return device ? device.name : id;
    };
    const { lines, limited } = cableTagLines(link, { cable: def.cable, nameA: nameOf(def.a), nameB: nameOf(def.b), lang: language() });
    const base = limited ? 0.55 : 0.48;
    const tag = render.makeLabel(lines, {
      size: base * (render.labelSize || 1),
      background: limited ? 'rgba(146, 64, 14, 0.94)' : 'rgba(30, 41, 59, 0.82)',
      color: limited ? '#fff7ed' : '#cbd5e1',
    });
    if (!tag) return null;
    tag.userData.base = base;
    tag.userData.limited = limited;
    render.linksLayer.add(tag);
    if (render.linkLabels) render.linkLabels.push(tag);
    return tag;
  }

  /** Quelles étiquettes de câbles montrer : bridées toujours ; les autres selon le contexte. */
  function tagVisibility() {
    render.camera.getWorldPosition(eye);
    const scale = render.world ? render.world.scale.x || 1 : 1;
    for (const [id, entry] of state) {
      if (!entry.tag) continue;
      if (entry.tag.userData.limited || showAll) { entry.tag.visible = true; continue; }
      const { a, b } = entry.cable.userData;
      if (selected && (a === selected || b === selected)) { entry.tag.visible = true; continue; }
      entry.tag.getWorldPosition(spot);
      entry.tag.visible = eye.distanceTo(spot) / scale < TAG_DISTANCE;
    }
  }

  /** Lueur de passage autour du câble, retracée avec lui (déplacement dans l'éditeur, labo). */
  function attachGlow(entry) {
    const { cable } = entry;
    const map = dashTexture();
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0xffffff, alphaMap: map, transparent: true, opacity: PASSAGE_OPACITY, depthWrite: false, toneMapped: false,
    }));
    glow.visible = false;
    glow.raycast = () => {};
    cable.add(glow);
    entry.glow = glow;
    const reshape = () => {
      const old = glow.geometry;
      const { curve, length } = cable.userData;
      glow.geometry = new THREE.TubeGeometry(curve, Math.min(120, Math.max(24, Math.round(length * 14))), CABLE_RADIUS * 1.7 * (cable.userData.thickness || 1), 6, false);
      if (old) old.dispose();
      map.repeat.x = Math.max(1, length / DASH);
      placeTags(entry);
    };
    cable.userData.onPlace = reshape;
    reshape();
  }

  /** Étiquettes au milieu du câble : vitesse, puis charge au-dessus. */
  function placeTags(entry) {
    const middle = entry.cable.userData.curve.getPointAt(0.5);
    const k = entry.cable.userData.thickness || 1; // mode classique : étiquettes plus grandes, plus haut
    if (entry.tag) entry.tag.position.set(middle.x, middle.y + 0.42 * k, middle.z);
    if (entry.loadTag) entry.loadTag.position.set(middle.x, middle.y + (entry.tag ? 0.8 : 0.42) * k, middle.z);
  }

  function build() {
    state.clear();
    passages.clear();
    const scenario = sim.scenario;
    if (!scenario) return;
    for (const def of scenario.links || []) {
      const cable = render.linkObject(def.id);
      if (!cable || !cable.userData.tube) continue;
      const entry = { cable, glow: null, tag: cableTag(def, sim.link(def.id)), loadTag: null, load: 0, level: 'idle', down: false };
      attachGlow(entry);
      state.set(def.id, entry);
    }
    lastSimNow = sim.now;
  }

  /** Étiquette de charge : visible seulement au-delà de 50 % (orange) ou 80 % (rouge). */
  function paintLoad(entry) {
    const show = !entry.down && (entry.level === 'busy' || entry.level === 'saturated');
    if (!show) {
      if (entry.loadTag) entry.loadTag.visible = false;
      return;
    }
    const text = `${language() === 'en' ? 'Load' : 'Charge'} ${Math.round(entry.load * 100)} %`;
    if (!entry.loadTag || entry.loadTag.userData.level !== entry.level) {
      if (entry.loadTag) render.linksLayer.remove(entry.loadTag);
      entry.loadTag = render.makeLabel([text], { size: 0.55 * (render.labelSize || 1), background: LOAD_BACKGROUNDS[entry.level] });
      if (!entry.loadTag) return;
      entry.loadTag.userData.level = entry.level;
      entry.loadTag.userData.base = 0.55;
      render.linksLayer.add(entry.loadTag);
      placeTags(entry);
    } else if (entry.loadTag.userData.lines !== text) {
      updateLabel(entry.loadTag, [text]);
    }
    entry.loadTag.visible = true;
  }

  function refresh() {
    const traffic = sim.traffic();
    for (const [id, entry] of state) {
      entry.down = isDown(sim, sim.link(id));
      const data = traffic && traffic.links[id];
      entry.load = entry.down ? 0 : (data ? data.max : 0);
      entry.level = entry.down ? 'down' : loadLevel(entry.load);
      entry.cable.userData.tube.material.color.set(entry.down ? DOWN_COLOR : entry.cable.userData.jacket);
      paintLoad(entry);
    }
  }

  /** Lueur de passage d'un câble à l'instant `now` (couleur du protocole du dernier paquet émis). */
  function paintPassage(id, entry, now, simDt) {
    const passage = passages.get(id);
    const glow = entry.glow;
    const active = passage && !entry.down && now >= passage.start && now <= passage.end + FADE_OUT;
    if (!active) { glow.visible = false; return; }
    glow.visible = true;
    glow.material.color.set(passage.color);
    const fading = now > passage.end ? 1 - (now - passage.end) / FADE_OUT : 1;
    glow.material.opacity = PASSAGE_OPACITY * Math.max(0, fading);
    // Le motif court dans le sens du paquet, au rythme de l'horloge simulée.
    if (simDt) glow.material.alphaMap.offset.x -= passage.direction * simDt * 1.4;
  }

  // Les autres modules (rendu et interface) sont prévenus après la construction de la scène.
  sim.on(Topics.SCENARIO_LOADED, build);
  sim.on(Topics.RESET, () => { passages.clear(); for (const entry of state.values()) { entry.glow.visible = false; if (entry.loadTag) entry.loadTag.visible = false; } lastSimNow = sim.now; });
  sim.on(Topics.PACKET_SEND, (event) => {
    const entry = state.get(event.linkId);
    if (!entry) return;
    passages.set(event.linkId, {
      color: render.packetColor(event.packet),
      start: event.time,
      end: event.time + (event.duration || 0),
      // La courbe du câble va du côté « a » au côté « b » du scénario.
      direction: entry.cable.userData.a === event.from ? 1 : -1,
    });
  });
  sim.on(Topics.PACKET_DROP, (event) => {
    const passage = event.onLink && passages.get(event.linkId);
    if (passage) passage.end = Math.min(passage.end, event.time);
  });

  render.onFrame((dt) => {
    const now = sim.now;
    const simDt = Math.max(0, now - lastSimNow) / 1000;
    lastSimNow = now;
    for (const [id, entry] of state) {
      if (flashing.left > 0 && flashing.ids.has(id)) continue;
      paintPassage(id, entry, now, simDt);
    }
    if (flashing.left > 0) {
      flashing.left -= dt;
      const on = flashing.left > 0 && Math.floor(flashing.left / 250) % 2 === 0;
      for (const id of flashing.ids) {
        const entry = state.get(id);
        if (!entry) continue;
        entry.glow.visible = on;
        if (on) { entry.glow.material.color.setHex(FLASH_COLOR); entry.glow.material.opacity = 0.9; }
      }
    }
    elapsed += dt;
    if (elapsed < REFRESH) return;
    elapsed = 0;
    refresh();
    tagVisibility();
  });
  // Équipement sélectionné (clic) : ses câbles montrent leur type et leur vitesse.
  sim.on(Topics.SELECT, (event) => { selected = event && event.kind === 'device' ? event.id : null; });
  if (sim.scenario) build();

  return {
    /** Charge affichée d'un lien : { load, level }. */
    of(id) {
      const entry = state.get(id);
      return entry ? { load: entry.load, level: entry.level } : { load: 0, level: 'idle' };
    },
    /** Couleur de la lueur de passage d'un lien (ou null si aucun paquet ne le traverse). */
    passageOf(id) {
      const entry = state.get(id);
      return entry && entry.glow.visible ? `#${entry.glow.material.color.getHexString()}` : null;
    },
    refresh,
    /** Onglet Construire : toutes les étiquettes de câbles visibles (true), ou selon le contexte (false). */
    setShowAll(value) { showAll = !!value; tagVisibility(); },
    /** Fait clignoter quelques câbles pendant 3 secondes (ex. constat du diagnostic). */
    flash(ids = []) {
      flashing = { ids: new Set(ids), left: ids.length ? 3000 : 0 };
    },
  };
}
