// Construire le laboratoire à la main : Steve prend, porte, pose, branche.
//
//   - MOBILIER : sur l'étagère « Mobilier », un clic prend un meuble (baie, poste de travail,
//     table) ; sa silhouette suit le regard au sol, verte si la place est libre ; R le tourne d'un
//     quart de tour, un clic le pose. F sur un meuble installé le reprend (ce qu'il porte suit).
//   - ÉQUIPEMENTS : sur l'étagère « Équipements », un clic met le modèle dans les mains de Steve. Il
//     marche jusqu'au meuble qui convient — baie pour un équipement de baie (l'emplacement U visé
//     s'allume), bureau pour un PC, table pour un boîtier de bureau — et un clic l'y installe.
//     F sur un équipement installé le reprend ; ses câbles restent branchés et le suivent.
//   - CÂBLES : sur la planche des câbles, un clic prend un câble. On vise une PRISE précise
//     (« SW1 · Gi0/3 — libre ») : un clic branche le premier bout ; on marche jusqu'à l'autre
//     équipement, un clic branche le second : le lien relie exactement ces deux ports.
//     F sur une prise câblée la débranche : le câble reste en main, l'autre bout toujours branché.
//   - F (les mains pleines) : reposer / annuler · Suppr : retirer du réseau ou de la salle.
//
// Chaque geste modifie le brouillon de l'éditeur (topologie et plan de la salle, champ `lab`) :
// annuler / rétablir, enregistrer et exporter marchent comme pour le reste de l'éditeur.
// La 3D (aperçu, mains, prises) est dans src/render/lab.mjs ; le plan dans src/render/labLayout.mjs.

import { MODELS, CABLES } from '../sim/catalog.mjs';
import * as B from '../sim/builder.mjs';
import { parseEndpoint } from '../sim/scenario.mjs';
import { displayName } from '../sim/cli.mjs';
import { systemOf } from '../sim/catalog.mjs';
import {
  FURNITURE, LAB_SCALE, canPlaceFurniture, canMount, slotAt, mountPose, mountKindsOf, unitsOf, ensureLayout,
  addFurniture, moveFurniture, removeFurniture, mountDevice,
} from '../render/labLayout.mjs';
import { localize, registerStrings, t } from './i18n.mjs';
import { Topics } from '../sim/events.mjs';
import { toast } from './toast.mjs';

registerStrings({
  fr: {
    'build.holding': 'En main : {what}',
    'build.goRack': "S'installe dans une baie ({units}U) : visez l'emplacement.",
    'build.goDesk': "Se pose sur un poste de travail (bureau) : visez-le.",
    'build.goTable': "Se pose sur une table de laboratoire : visez une moitié de la table.",
    'build.goRackOrTable': "Se pose dans une baie (sur une tablette, {units}U) ou sur une table : visez l'emplacement.",
    'build.slotFree': '{where} — libre',
    'build.slotTaken': '{where} — occupé',
    'build.slotKind': "{where} : ce meuble ne convient pas",
    'build.rackSlot': 'Baie {n} · U{u}',
    'build.deskSlot': 'Poste de travail',
    'build.tableSlot': 'Table · place {n}',
    'build.hintDeviceNew': 'Clic : installer · F : remettre sur l\'étagère',
    'build.hintDevice': 'Clic : installer ici · F : remettre à sa place · Suppr : retirer du réseau',
    'build.spotOk': 'Place libre',
    'build.spotWall': 'Trop près d\'un mur',
    'build.spotReserved': 'Passage réservé (étagères, porte)',
    'build.spotFurniture': 'Un autre meuble est là',
    'build.hintFurniture': 'Clic : poser · R : tourner · F : reposer',
    'build.hintFurnitureOld': 'Clic : poser ici · R : tourner · F : laisser à sa place · Suppr : retirer de la salle',
    'build.cableAim': 'Visez la prise du premier équipement.',
    'build.cableSecond': 'Bout 1 branché sur {from} : branchez l\'autre bout.',
    'build.portFree': '{device} · {port} — libre',
    'build.portTaken': '{device} · {port} — occupée',
    'build.noPort': '{device} : visez une prise précise',
    'build.hintCable': 'Clic : brancher · F : ranger le câble',
    'build.takeHint': 'F : prendre',
    'build.unplugHint': 'Prise {port} câblée — F : débrancher',
    'build.placedFurniture': '{what} posé.',
    'build.installed': '{name} installé : {where}.',
    'build.plugged': 'Câble {cable} branché : {a} ↔ {b}.',
    'build.unplugged': 'Câble débranché de {where} : l\'autre bout est toujours branché.',
    'build.portBusy': 'Cette prise est déjà occupée.',
    'build.samePort': 'Branchez l\'autre bout sur un autre équipement.',
    'build.walkFirst': 'Passez en mode « Marcher » pour construire.',
  },
  en: {
    'build.holding': 'In hand: {what}',
    'build.goRack': 'Goes into a rack ({units}U): aim at the slot.',
    'build.goDesk': 'Goes on a workstation (desk): aim at it.',
    'build.goTable': 'Goes on a lab bench: aim at one half of the bench.',
    'build.goRackOrTable': 'Goes into a rack (on a shelf, {units}U) or on a bench: aim at the place.',
    'build.slotFree': '{where} — free',
    'build.slotTaken': '{where} — taken',
    'build.slotKind': '{where}: this furniture does not fit',
    'build.rackSlot': 'Rack {n} · U{u}',
    'build.deskSlot': 'Workstation',
    'build.tableSlot': 'Bench · place {n}',
    'build.hintDeviceNew': 'Click: install · F: put back on the shelf',
    'build.hintDevice': 'Click: install here · F: put it back · Del: remove from the network',
    'build.spotOk': 'Free space',
    'build.spotWall': 'Too close to a wall',
    'build.spotReserved': 'Reserved passage (shelves, door)',
    'build.spotFurniture': 'Another piece of furniture is there',
    'build.hintFurniture': 'Click: place · R: rotate · F: put back',
    'build.hintFurnitureOld': 'Click: place here · R: rotate · F: leave it where it was · Del: remove from the room',
    'build.cableAim': 'Aim at the port of the first device.',
    'build.cableSecond': 'End 1 plugged into {from}: plug in the other end.',
    'build.portFree': '{device} · {port} — free',
    'build.portTaken': '{device} · {port} — taken',
    'build.noPort': '{device}: aim at a precise port',
    'build.hintCable': 'Click: plug in · F: put the cable away',
    'build.takeHint': 'F: pick up',
    'build.unplugHint': 'Port {port} cabled — F: unplug',
    'build.placedFurniture': '{what} placed.',
    'build.installed': '{name} installed: {where}.',
    'build.plugged': '{cable} cable plugged in: {a} ↔ {b}.',
    'build.unplugged': 'Cable unplugged from {where}: the other end is still plugged in.',
    'build.portBusy': 'This port is already taken.',
    'build.samePort': 'Plug the other end into another device.',
    'build.walkFirst': 'Switch to "Walk" mode to build.',
  },
});

const SPOT_KEYS = { wall: 'build.spotWall', reserved: 'build.spotReserved', furniture: 'build.spotFurniture' };
const NEW_ID = '__nouveau';

export function initLabBuild(app) {
  const { sim, render } = app;
  const lab = render && render.lab;
  if (!lab || !app.editor) return null;

  /**
   * Ce que Steve a en main :
   *   { type: 'device', def, isNew } — un équipement (nouveau, ou repris de son meuble) ;
   *   { type: 'furniture', kind, id?, rot } — un meuble (nouveau, ou repris) ;
   *   { type: 'cable', cable, first: { device, port, point } | null } — un câble, un bout branché ou non.
   */
  let held = null;
  let spot = null; // où le geste suivant poserait l'objet (calculé à chaque image)
  let busy = false; // un objet est en train de glisser vers sa place : on attend
  let vrTarget = null; // en VR : ce que vise la manette (le viseur est alors le rayon)
  const presenting = () => !!(render.isPresenting && render.isPresenting());
  const aimed = () => (presenting() ? vrTarget : lab.target);

  const devices = () => (sim.scenario && sim.scenario.devices) || [];
  const deviceDef = (id) => devices().find((d) => d.id === id) || null;
  const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'fr');
  const errorText = (error) => (error && error.text ? error.text[lang()] || error.text.fr : String((error && error.message) || error));
  const portLabel = (deviceId, port) => {
    const def = deviceDef(deviceId);
    return def ? displayName(systemOf(def).dialect, port) : port;
  };
  const linkAt = (deviceId, port) => ((sim.scenario && sim.scenario.links) || []).find((l) => l.a === `${deviceId}:${port}` || l.b === `${deviceId}:${port}`) || null;
  const rackNumber = (furnitureId) => lab.layout.furniture.filter((f) => FURNITURE[f.kind].kind === 'rack').findIndex((f) => f.id === furnitureId) + 1;

  /** Où est (ou serait) un équipement : « Baie 1 · U5 », « Poste de travail », « Table · place 2 ». */
  function whereText(furnitureId, slot) {
    const item = lab.layout.furniture.find((f) => f.id === furnitureId);
    if (!item) return '';
    const kind = FURNITURE[item.kind].kind;
    if (kind === 'rack') return t('build.rackSlot', { n: rackNumber(furnitureId), u: slot });
    if (kind === 'desk') return t('build.deskSlot');
    return t('build.tableSlot', { n: slot + 1 });
  }

  /** Applique une opération au brouillon de l'éditeur (le crée au premier geste). Vrai si réussi. */
  function apply(operation) {
    const base = app.editor.active ? app.editor.draft : B.draftFrom(sim.scenario);
    let next;
    try {
      next = operation(base);
    } catch (error) {
      toast(errorText(error), { kind: 'error' });
      return false;
    }
    // Premier geste : l'éditeur s'ouvre sur le réseau modifié, le réseau d'origine gardé dans son
    // historique (le geste reste annulable, comme tout geste suivant ; un seul rechargement).
    if (app.editor.active) app.editor.change(() => next);
    else app.editor.start(next, base);
    return true;
  }

  /** Orientation d'un meuble pris : sa façade tournée vers Steve (quart de tour le plus proche). */
  function facingRot() {
    const direction = render.camera.getWorldDirection(new render.camera.position.constructor());
    const yaw = Math.atan2(-direction.x, -direction.z) * (180 / Math.PI);
    return (((Math.round(yaw / 90) * 90) % 360) + 360) % 360;
  }

  // ------------------------------------------------------------------ prendre
  function takeNewDevice(type, model, from = null) {
    release();
    held = { type: 'device', def: { id: NEW_ID, type, model, name: MODELS[model].name }, isNew: true };
    lab.holdDevice(held.def, from); // il glisse de l'étagère jusqu'aux mains
    lab.hands.reach();
  }
  function takeNewFurniture(kind) {
    release();
    held = { type: 'furniture', kind, rot: facingRot(), turns: 0, facing: true };
    lab.pushFurniture(true);
    lab.hands.reach();
  }
  function takeCable(cable) {
    release();
    held = { type: 'cable', cable, first: null };
    if (app.editor.setCable) app.editor.setCable(cable);
    lab.holdCable(cable);
    lab.hands.reach();
  }
  /** F sur ce que vise le viseur : reprendre un équipement ou un meuble, débrancher une prise. */
  function takeInstalled(target) {
    if (!target) return;
    if (target.kind === 'device') {
      if (target.port && linkAt(target.id, target.port)) { unplug(target.id, target.port); return; }
      const def = deviceDef(target.id);
      if (!def) return;
      release();
      held = { type: 'device', def, isNew: false };
      lab.holdDevice(def, target.object || (render.deviceObject && render.deviceObject(def.id))); // il quitte son meuble
      lab.hideDevice(def.id, true);
      lab.hands.reach();
    } else if (target.kind === 'furniture') {
      const item = lab.layout.furniture.find((f) => f.id === target.id);
      if (!item) return;
      release();
      held = { type: 'furniture', kind: item.kind, id: item.id, rot: item.rot, turns: 0, facing: false };
      lab.pushFurniture(true);
      lab.hands.reach();
    } else if (target.kind === 'catalog') takeNewDevice(target.type, target.model, target.object);
    else if (target.kind === 'furnitureCatalog') takeNewFurniture(target.furniture);
    else if (target.kind === 'cable') takeCable(target.cable);
  }
  function unplug(deviceId, port) {
    const link = linkAt(deviceId, port);
    if (!link) return;
    const mine = parseEndpoint(link.a).device === deviceId && parseEndpoint(link.a).iface === port ? 'a' : 'b';
    const other = parseEndpoint(mine === 'a' ? link.b : link.a);
    const point = lab.portPoint(other.device, other.iface);
    if (!apply((draft) => B.removeLink(draft, link.id))) return;
    release();
    held = { type: 'cable', cable: link.cable || 'cat6', first: { device: other.device, port: other.iface, point: point ? point.toArray() : null } };
    lab.holdCable(held.cable, held.first.point);
    lab.hands.reach();
    toast(t('build.unplugged', { where: `${(deviceDef(deviceId) || {}).name} ${portLabel(deviceId, port)}` }));
  }

  // ------------------------------------------------------------------ poser, installer, brancher
  function place(target) {
    if (!held) return false;
    if (busy) return true;
    lab.hands.reach();
    if (held.type === 'furniture') {
      if (!spot || !spot.ok) { toast(t(SPOT_KEYS[spot && spot.reason] || 'build.spotFurniture'), { kind: 'error' }); return true; }
      const { kind, id } = held;
      const { x, z, rot } = spot;
      const done = apply((draft) => (id ? moveFurniture(draft, id, x, z, rot) : addFurniture(draft, kind, x, z, rot).draft));
      if (done) { toast(t('build.placedFurniture', { what: localize(FURNITURE[kind].name) })); release({ restore: false }); }
      return true;
    }
    if (held.type === 'device') {
      if (!spot) { toast(t(mountHintKey(held.def), { units: unitsOf(held.def) }), { kind: 'error' }); return true; }
      if (!spot.ok) { toast(t(spot.reason === 'kind' ? 'build.slotKind' : 'build.slotTaken', { where: whereText(spot.furniture, spot.slot) }), { kind: 'error' }); return true; }
      const { def, isNew } = held;
      const { furniture, slot } = spot;
      let name = def.name;
      busy = true;
      lab.dropHeld().then(() => {
        busy = false;
        installDevice(def, isNew, furniture, slot, name);
      });
      return true;
    }
    if (held.type === 'cable') {
      return plugCable(target);
    }
    return false;
  }

  /** Installe l'équipement porté (après l'animation de pose). */
  function installDevice(def, isNew, furniture, slot, initialName) {
    let name = initialName;
    const done = apply((draft) => {
      if (!isNew) return mountDevice(draft, def.id, furniture, slot);
      const item = (draft.lab || lab.layout).furniture.find((f) => f.id === furniture) || lab.layout.furniture.find((f) => f.id === furniture);
      const near = item ? [item.x / LAB_SCALE, 0, item.z / LAB_SCALE] : [0, 0, 0];
      // Le plan d'abord écrit : le nouvel équipement ne reçoit pas de meuble à lui (qui resterait vide).
      const planned = ensureLayout(draft);
      const added = B.addDevice(planned, def.type, { model: def.model, position: B.freePosition(planned, near) });
      name = added.draft.devices.find((d) => d.id === added.id).name;
      return mountDevice(added.draft, added.id, furniture, slot);
    });
    if (done) { toast(t('build.installed', { name, where: whereText(furniture, slot) })); release({ restore: false }); }
    else lab.holdDevice(def); // refusé : il revient dans les mains
  }

  /** Brancher un bout du câble porté sur la prise visée. */
  function plugCable(target) {
    if (!target || target.kind !== 'device') { toast(t('build.cableAim'), { kind: 'error' }); return true; }
    const def = deviceDef(target.id);
    if (!target.port) { toast(t('build.noPort', { device: def ? def.name : target.id }), { kind: 'error' }); return true; }
    if (linkAt(target.id, target.port)) { toast(t('build.portBusy'), { kind: 'error' }); return true; }
    if (!held.first) {
      const point = lab.portPoint(target.id, target.port);
      held.first = { device: target.id, port: target.port, point: point ? point.toArray() : null };
      lab.holdCable(held.cable, held.first.point);
      return true;
    }
    if (held.first.device === target.id) { toast(t('build.samePort'), { kind: 'error' }); return true; }
    const { cable, first } = held;
    const done = apply((draft) => B.addLink(draft, first.device, target.id, { portA: first.port, portB: target.port, cable }).draft);
    if (done) {
      const a = `${(deviceDef(first.device) || {}).name} ${portLabel(first.device, first.port)}`;
      const b = `${def ? def.name : target.id} ${portLabel(target.id, target.port)}`;
      toast(t('build.plugged', { cable: CABLES[cable].name, a, b }));
      release({ restore: false });
    }
    return true;
  }

  const mountHintKey = (def) => {
    const kinds = mountKindsOf(def);
    if (kinds.length > 1) return 'build.goRackOrTable';
    return { rack: 'build.goRack', desk: 'build.goDesk', table: 'build.goTable' }[kinds[0]];
  };

  /** Mains vides. `restore` : un équipement repris revient à sa place (il était masqué). */
  function release({ restore = true } = {}) {
    if (held && held.type === 'device' && !held.isNew && restore) lab.hideDevice(held.def.id, false);
    held = null;
    spot = null;
    lab.preview(null);
    lab.holdDevice(null);
    lab.holdCable(null);
    lab.pushFurniture(false);
  }
  /** Suppr, les mains pleines : retirer l'équipement du réseau, le meuble de la salle. */
  function remove() {
    if (!held) return;
    if (held.type === 'device' && !held.isNew) {
      const { id } = held.def;
      if (apply((draft) => B.removeDevice(draft, id))) release({ restore: false });
      return;
    }
    if (held.type === 'furniture' && held.id) {
      const { id } = held;
      if (apply((draft) => removeFurniture(draft, id))) release();
      return;
    }
    release();
  }
  /** R : un quart de tour de plus (un meuble neuf garde sinon sa façade tournée vers Steve). */
  function rotate() {
    if (held && held.type === 'furniture') held.turns = (held.turns + 1) % 4;
  }
  const furnitureRot = () => ((held.facing ? facingRot() : held.rot) + held.turns * 90) % 360;

  // ------------------------------------------------------------------ aperçu (à chaque image)
  function tick() {
    if (busy) return; // la silhouette reste en place pendant que l'objet la rejoint
    if (!held || !lab.active || lab.mode !== 'walk') { lab.preview(null); spot = null; return; }
    const layout = lab.layout;
    if (held.type === 'furniture') {
      // En VR, le meuble se pose là où le rayon touche le sol ; sinon devant Steve.
      const onFloor = presenting() && vrTarget && vrTarget.kind === 'floor' && vrTarget.point;
      const [fx, fz] = onFloor ? [vrTarget.point.x, vrTarget.point.z] : lab.floorAhead();
      const x = Math.round(fx * 20) / 20;
      const z = Math.round(fz * 20) / 20;
      const rot = furnitureRot();
      const check = canPlaceFurniture(layout, { id: held.id || NEW_ID, kind: held.kind, x, z, rot }, held.id || null);
      spot = { x, z, rot, ok: check.ok, reason: check.reason };
      lab.preview({ type: 'furniture', kind: held.kind, x, z, rot, ok: check.ok });
      return;
    }
    if (held.type === 'device') {
      let target = aimed();
      // Viser un équipement déjà installé, c'est viser son meuble à cet endroit (installer à côté).
      if (target && target.kind === 'device' && target.point && layout.mounts[target.id]) target = { kind: 'furniture', id: layout.mounts[target.id].on, point: target.point };
      if (!target || target.kind !== 'furniture' || !target.point) { spot = null; lab.preview(null); return; }
      const all = held.isNew ? [...devices(), held.def] : devices();
      const slot = slotAt(layout, all, held.def, target.id, target.point);
      const check = canMount(layout, all, held.def, target.id, slot);
      spot = { furniture: target.id, slot, ok: check.ok, reason: check.reason };
      if (check.reason === 'kind') { lab.preview(null); return; }
      const pose = mountPose({ ...layout, mounts: { ...layout.mounts, [held.def.id]: { on: target.id, slot } } }, held.def);
      if (pose) lab.preview({ type: 'device', def: held.def, point: pose.point, rot: pose.rot, ok: check.ok });
      return;
    }
    spot = null;
    lab.preview(null);
  }
  render.onFrame(tick);
  // Un rechargement (geste réussi, annuler, autre scénario) reconstruit la salle : rien en main
  // ne doit pointer vers un équipement qui n'existe plus.
  sim.on(Topics.SCENARIO_LOADED, () => {
    if (held && held.type === 'device' && !held.isNew && !deviceDef(held.def.id)) release({ restore: false });
    if (held && held.type === 'device' && !held.isNew) lab.hideDevice(held.def.id, true);
  });

  // ------------------------------------------------------------------ fiche (ce que montre le viseur)
  /** Fiche à afficher quand Steve a quelque chose en main : { title, lines, hint }, sinon null. */
  function card(target) {
    if (!held) return null;
    if (held.type === 'furniture') {
      return {
        title: t('build.holding', { what: localize(FURNITURE[held.kind].name) }),
        lines: [spot ? (spot.ok ? t('build.spotOk') : t(SPOT_KEYS[spot.reason] || 'build.spotFurniture')) : ''],
        hint: t(held.id ? 'build.hintFurnitureOld' : 'build.hintFurniture'),
        ok: !!(spot && spot.ok),
      };
    }
    if (held.type === 'device') {
      const what = held.isNew ? MODELS[held.def.model].name : `${held.def.name} (${MODELS[held.def.model] ? MODELS[held.def.model].name : held.def.type})`;
      let status = t(mountHintKey(held.def), { units: unitsOf(held.def) });
      if (spot) {
        const where = whereText(spot.furniture, spot.slot);
        status = spot.ok ? t('build.slotFree', { where }) : spot.reason === 'kind' ? t('build.slotKind', { where }) : t('build.slotTaken', { where });
      }
      return { title: t('build.holding', { what }), lines: [status], hint: t(held.isNew ? 'build.hintDeviceNew' : 'build.hintDevice'), ok: !!(spot && spot.ok) };
    }
    const cable = CABLES[held.cable];
    let status = held.first ? t('build.cableSecond', { from: `${(deviceDef(held.first.device) || {}).name} ${portLabel(held.first.device, held.first.port)}` }) : t('build.cableAim');
    let ok = false;
    if (target && target.kind === 'device') {
      const def = deviceDef(target.id);
      const name = def ? def.name : target.id;
      if (!target.port) status = t('build.noPort', { device: name });
      else {
        ok = !linkAt(target.id, target.port) && !(held.first && held.first.device === target.id);
        status = t(linkAt(target.id, target.port) ? 'build.portTaken' : 'build.portFree', { device: name, port: portLabel(target.id, target.port) });
      }
    }
    return { title: t('build.holding', { what: cable.name }), lines: [status], hint: t('build.hintCable'), ok };
  }
  /** Ligne ajoutée à la fiche d'un objet visé, les mains vides (prendre, débrancher). */
  function extraHint(target) {
    if (held || !target) return '';
    if (target.kind === 'device') {
      if (target.port && linkAt(target.id, target.port)) return t('build.unplugHint', { port: portLabel(target.id, target.port) });
      return t('build.takeHint');
    }
    if (target.kind === 'furniture') return t('build.takeHint');
    return '';
  }

  /**
   * Clic (souris, toucher, gâchette VR) sur ce que vise le viseur. Vrai si le geste a été traité
   * ici ; sinon l'interface du labo fait le geste habituel (sélectionner, console…).
   */
  function click(target) {
    if (held) return place(target);
    if (!target) return false;
    if (target.kind === 'catalog') { takeNewDevice(target.type, target.model, target.object); return true; }
    if (target.kind === 'furnitureCatalog') { takeNewFurniture(target.furniture); return true; }
    if (target.kind === 'cable') { takeCable(target.cable); return true; }
    return false;
  }

  window.addEventListener('keydown', (event) => {
    if (!lab.active || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (event.code === 'KeyF') {
      if (lab.mode !== 'walk') { toast(t('build.walkFirst')); return; }
      if (held) release(); else takeInstalled(lab.target);
    } else if (event.code === 'KeyR') rotate();
    else if (event.code === 'Delete' || event.code === 'Backspace') { if (held) { event.preventDefault(); remove(); } }
  });

  return {
    get held() { return held; },
    get spot() { return spot; },
    click,
    /** F : prendre ce qui est visé, ou reposer ce qu'on a en main. */
    grab(target = aimed()) { if (held) release(); else takeInstalled(target); },
    /** VR : ce que vise la manette (controllers.mjs, à chaque image). */
    setVRTarget(target) { vrTarget = target || null; },
    rotate,
    remove,
    release,
    card,
    extraHint,
  };
}
