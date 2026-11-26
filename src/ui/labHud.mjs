// Interface du laboratoire (S7) : le bouton « Mode classique / Retour au labo », le viseur, la
// fiche de ce que Steve regarde, l'aide des touches, le joystick tactile et l'accueil.
//
// L'application s'ouvre dans le laboratoire ; le mode classique (vue d'ensemble de la topologie :
// qui est relié à qui) s'ouvre à la demande. `?classique` dans l'adresse ouvre directement le mode classique.
//
// La salle et la caméra sont dans src/render/lab.mjs ; ce fichier relie ce que Steve vise
// aux autres parties : sélection (panneau Équipement), consoles (terminal.mjs) et éditeur
// (pour poser un modèle pris sur l'étagère « Équipements »).
//
// Touches : ZQSD / WASD marcher · souris regarder · clic sélectionner (ou prendre, poser,
// brancher : labBuild.mjs) · F prendre / reposer · R tourner un meuble · E console ·
// V survol / marche · B construire · Échap libérer la souris · L mode classique / retour au labo.

import { Topics } from '../sim/events.mjs';
import { MODELS, CABLES, cableSummary, modelOf, systemOf } from '../sim/catalog.mjs';
import { FURNITURE } from '../render/labLayout.mjs';
import * as B from '../sim/builder.mjs';
import { el } from './dom.mjs';
import { localize, onLangChange, registerStrings, t } from './i18n.mjs';
import { hasConsole } from './terminal.mjs';
import { toast } from './toast.mjs';
import { initLabBuild } from './labBuild.mjs';

registerStrings({
  fr: {
    'lab.enter': 'Retour au labo',
    'lab.enterTitle': 'Revenir dans le laboratoire (vue à la première personne) · touche L',
    'lab.exit': 'Mode classique',
    'lab.exitTitle': "Vue d'ensemble de la topologie : qui est relié à qui · touche L",
    'lab.walk': 'Marcher',
    'lab.overview': 'Survol',
    'lab.resume': 'Cliquez dans la scène pour regarder autour de vous',
    'lab.keys': 'ZQSD / WASD : marcher · Souris : regarder · Clic : choisir, poser, brancher · F : prendre / reposer · R : tourner · E : console · V : survol · L : mode classique · Échap : libérer la souris',
    'lab.keysTouch': 'Joystick : marcher · Glisser : regarder · Toucher : choisir',
    'lab.device': 'Clic : sélectionner · E : ouvrir la console',
    'lab.deviceTouch': 'Boutons « Console » et « Choisir »',
    'lab.deviceNoConsole': 'Clic : sélectionner · pas de console (non administrable)',
    'lab.catalog': 'Clic : le prendre en main, puis l\'installer sur un meuble (baie, bureau ou table)',
    'lab.furnitureCatalog': 'Clic : le prendre, puis le poser dans la salle (R : tourner)',
    'lab.furniture': 'Meuble',
    'lab.grab': 'Prendre',
    'lab.rotate': 'Tourner',
    'lab.os': '{os} · commandes {dialect}',
    'lab.added': '{model} installé devant vous : reliez-le avec l\'outil « Relier » de l\'onglet Construire.',
    'lab.cable': 'Clic : prendre ce câble, puis brancher ses deux bouts, prise par prise',
    'lab.packet': "Clic : afficher son contenu dans l'inspecteur (mettez d'abord en pause)",
    'lab.cableChosen': 'Câble choisi : {cable}. Les prochains branchements (outil « Relier », bouton « Câbler » en VR) l\'utiliseront.',
    'lab.welcomeTitle': 'Bienvenue au labo, Steve',
    'lab.welcome': 'Les switchs, routeurs, pare-feu et serveurs du scénario sont installés dans les baies ; les PC sont sur les postes de travail. Visez un routeur, un switch ou un pare-feu et appuyez sur E pour ouvrir sa console. Pour monter votre propre réseau : prenez un meuble sur l\'étagère « Mobilier » et posez-le (R : tourner), prenez un modèle sur l\'étagère « Équipements » et installez-le sur le bon meuble, puis prenez un câble et branchez-le prise par prise. F reprend ce que vous visez (ou débranche une prise) et repose ce que vous avez en main.',
    'lab.start': 'Commencer',
    'lab.missions': 'Missions',
    'lab.console': 'Console',
    'lab.select': 'Choisir',
  },
  en: {
    'lab.enter': 'Back to the lab',
    'lab.enterTitle': 'Go back into the laboratory (first-person view) · L key',
    'lab.exit': 'Classic view',
    'lab.exitTitle': 'Overview of the topology: who is connected to whom · L key',
    'lab.walk': 'Walk',
    'lab.overview': 'Overview',
    'lab.resume': 'Click in the scene to look around',
    'lab.keys': 'WASD / ZQSD: walk · Mouse: look · Click: choose, place, plug in · F: pick up / put back · R: rotate · E: console · V: overview · L: classic view · Esc: release the mouse',
    'lab.keysTouch': 'Joystick: walk · Drag: look · Tap: choose',
    'lab.device': 'Click: select · E: open the console',
    'lab.deviceTouch': '"Console" and "Choose" buttons',
    'lab.deviceNoConsole': 'Click: select · no console (unmanaged)',
    'lab.catalog': 'Click: take it in hand, then install it on a piece of furniture (rack, desk or bench)',
    'lab.furnitureCatalog': 'Click: take it, then place it in the room (R: rotate)',
    'lab.furniture': 'Furniture',
    'lab.grab': 'Pick up',
    'lab.rotate': 'Rotate',
    'lab.os': '{os} · {dialect} commands',
    'lab.added': '{model} installed in front of you: connect it with the "Connect" tool in the Build tab.',
    'lab.cable': 'Click: take this cable, then plug in both ends, port by port',
    'lab.packet': 'Click: show its content in the inspector (pause first)',
    'lab.cableChosen': 'Cable chosen: {cable}. The next connections ("Connect" tool, "Cable" button in VR) will use it.',
    'lab.welcomeTitle': 'Welcome to the lab, Steve',
    'lab.welcome': 'The scenario\'s switches, routers, firewalls and servers are installed in the racks; the PCs sit on the workstations. Aim at a router, a switch or a firewall and press E to open its console. To build your own network: take a piece of furniture from the "Furniture" shelf and place it (R: rotate), take a model from the "Equipment" shelf and install it on the right furniture, then take a cable and plug it in port by port. F picks up what you aim at (or unplugs a port) and puts back what you hold.',
    'lab.start': 'Start',
    'lab.missions': 'Missions',
    'lab.console': 'Console',
    'lab.select': 'Choose',
  },
});

const TYPE_KEYS = { host: 'info.type.host', server: 'info.type.server', switch: 'info.type.switch', router: 'info.type.router', firewall: 'info.type.firewall' };

export function initLabHud(app) {
  const { sim, render } = app;
  const lab = render && render.lab;
  const sceneBox = document.getElementById('scene');
  if (!lab || !sceneBox) return null;
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let welcomed = false;

  // ----------------------------------------------------------- éléments
  const crosshair = el('div', { class: 'lab-crosshair', 'aria-hidden': 'true' });
  const card = el('div', { class: 'lab-card', hidden: true, role: 'status' });
  const resume = el('div', { class: 'lab-resume', hidden: true }, t('lab.resume'));
  const keys = el('div', { class: 'lab-keys' });
  const modeButton = el('button', { type: 'button', class: 'btn', id: 'lab-mode', onclick: () => lab.toggleMode() });
  // Un seul bouton pour changer de vue, en haut à droite de la scène : « Mode classique » dans le
  // labo (à côté de « Survol / Marcher »), « Retour au labo » en mode classique.
  const viewButton = el('button', { type: 'button', class: 'btn', id: 'lab-view', onclick: () => (lab.active ? lab.exit() : lab.enter()) });
  const bar = el('div', { class: 'lab-bar' }, modeButton, viewButton);
  const touchButtons = el('div', { class: 'lab-touch-actions' },
    el('button', { type: 'button', class: 'btn btn-primary', id: 'lab-touch-console', onclick: () => act('console') }, t('lab.console')),
    el('button', { type: 'button', class: 'btn', id: 'lab-touch-select', onclick: () => act('select') }, t('lab.select')),
    el('button', { type: 'button', class: 'btn', id: 'lab-touch-grab', onclick: () => { if (build) build.grab(lab.target || lastTouched); } }, t('lab.grab')),
    el('button', { type: 'button', class: 'btn', id: 'lab-touch-rotate', onclick: () => { if (build) build.rotate(); } }, t('lab.rotate')));
  const knob = el('div', { class: 'lab-knob' });
  const joystick = el('div', { class: 'lab-joystick', 'aria-hidden': 'true' }, knob);
  const welcome = el('div', { class: 'lab-welcome', hidden: true, role: 'dialog' });
  const hud = el('div', { class: 'lab-hud', hidden: true },
    crosshair, card, resume, welcome,
    keys,
    touch ? joystick : null,
    touch ? touchButtons : null);
  sceneBox.append(hud, bar); // la barre reste visible en mode classique

  // ----------------------------------------------------------- fiche de l'objet visé
  function paintCard(target) {
    if (!lab.active) { card.hidden = true; return; }
    const holding = build && build.card(target);
    if (holding) {
      card.replaceChildren(el('strong', {}, holding.title), ...holding.lines.filter(Boolean).map((line) => el('p', { class: holding.ok ? 'lab-ok' : '' }, line)), el('p', { class: 'lab-hint' }, holding.hint));
      card.hidden = false;
      return;
    }
    if (!target) { card.hidden = true; return; }
    let title = ''; let lines = []; let hint = '';
    if (target.kind === 'device') {
      const def = sim.scenario.devices.find((d) => d.id === target.id);
      if (!def) { card.hidden = true; return; }
      const model = modelOf(def);
      const system = systemOf(def);
      const live = sim.device(def.id);
      const ips = live ? live.interfaces.filter((i) => i.ip).map((i) => `${i.name} ${i.ip}/${i.prefix}`) : [];
      title = `${def.name} — ${t(TYPE_KEYS[def.type] || 'info.type.host')}`;
      lines = [model ? model.name : '', model && (def.type !== 'switch' || model.os) && system ? t('lab.os', { os: system.name, dialect: system.dialect.toUpperCase() }) : '', ips.slice(0, 3).join(' · ')];
      hint = !hasConsole(def) ? t('lab.deviceNoConsole') : touch ? t('lab.deviceTouch') : t('lab.device');
    } else if (target.kind === 'catalog') {
      const model = MODELS[target.model];
      title = model.name;
      lines = [localize(model.description)];
      hint = t('lab.catalog');
    } else if (target.kind === 'furnitureCatalog') {
      title = localize(FURNITURE[target.furniture].name);
      lines = [localize(FURNITURE[target.furniture].description)];
      hint = t('lab.furnitureCatalog');
    } else if (target.kind === 'furniture') {
      title = localize(FURNITURE[target.furniture].name);
      lines = [];
      hint = '';
    } else if (target.kind === 'cable') {
      const cable = CABLES[target.cable];
      title = cable.name;
      lines = [localize(cableSummary(target.cable)), localize(cable.description)];
      hint = t('lab.cable');
    } else if (target.kind === 'packet') {
      const { packet } = target;
      title = packet.label;
      lines = [packet.ip ? `${packet.ip.src} → ${packet.ip.dst}` : packet.ipv6 ? `${packet.ipv6.src} → ${packet.ipv6.dst}` : `${packet.eth.src} → ${packet.eth.dst}`];
      hint = t('lab.packet');
    }
    const extra = build ? build.extraHint(target) : '';
    card.replaceChildren(...[el('strong', {}, title), ...lines.filter(Boolean).map((line) => el('p', {}, line)),
      hint ? el('p', { class: 'lab-hint' }, hint) : null, extra ? el('p', { class: 'lab-hint' }, extra) : null].filter(Boolean));
    card.hidden = false;
  }

  // ----------------------------------------------------------- actions
  function addFromCatalog(type, model) {
    if (!app.editor) return;
    const at = lab.spotAhead();
    let created = null;
    const add = (draft) => {
      const result = B.addDevice(draft, type, { model, position: B.freePosition(draft, at) });
      created = result.id;
      return result.draft;
    };
    // Premier ajout : le scénario affiché devient un brouillon de l'éditeur (une seule recharge).
    if (!app.editor.active) app.editor.start(add(B.draftFrom(sim.scenario)));
    else app.editor.change(add);
    if (created) toast(t('lab.added', { model: MODELS[model].name }));
  }

  /** Choisit le câble des prochains branchements (outil « Relier », bouton « Câbler » en VR). */
  function pickCable(id) {
    if (!CABLES[id]) return;
    if (app.editor && app.editor.setCable) app.editor.setCable(id);
    toast(t('lab.cableChosen', { cable: CABLES[id].name }));
  }

  /** `what` : 'select' | 'console' — sur la cible du viseur (ou celle passée). */
  function act(what, target = lab.target) {
    if (!target && !(build && build.held)) target = lastTouched; // mains pleines : pas d'ancienne cible
    if (build && what !== 'console' && build.click(target)) { paintCard(lab.target); return; }
    if (!target) return;
    if (target.kind === 'catalog') { addFromCatalog(target.type, target.model); return; }
    if (target.kind === 'cable') { pickCable(target.cable); return; }
    if (target.kind === 'packet') {
      // Le contenu du paquet s'affiche dans l'inspecteur (onglet Lecture), champ par champ.
      if (document.pointerLockElement) document.exitPointerLock();
      if (app.selection) app.selection.select({ kind: 'packet', packet: target.packet });
      return;
    }
    if (target.kind !== 'device') return;
    if (app.selection) app.selection.select({ kind: 'device', id: target.id });
    if (what === 'console' && app.terminals) {
      if (document.pointerLockElement) document.exitPointerLock();
      app.terminals.open(target.id);
    }
  }

  const build = initLabBuild(app);
  lab.onTarget(paintCard);
  // Les mains pleines, la fiche suit ce qui change sans que la cible change (place au sol, U visé).
  let cardClock = 0;
  render.onFrame((dt) => {
    if (!build || !build.held || !lab.active) return;
    cardClock += dt;
    if (cardClock > 120) { cardClock = 0; paintCard(lab.target); }
  });
  let lastTouched = null;
  lab.onTap((hit) => {
    // Les mains pleines, un clic sans cible (on regarde le sol pour poser un meuble) pose quand même.
    if (!hit) { if (build && build.held) act('select', null); return; }
    // Sur écran tactile, toucher un équipement le vise : la fiche et les boutons suivent.
    if (touch && hit.kind === 'device') { paintCard(hit); lastTouched = hit; }
    act('select', hit);
  });

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target && event.target.isContentEditable)) return;
    // L : du mode classique, retour au labo (dans le labo, la même touche ouvre le mode classique).
    if (!lab.active) {
      if (event.code === 'KeyL' && !(render.isPresenting && render.isPresenting())) lab.enter();
      return;
    }
    if (event.code === 'KeyE') act('console', lab.target || lastTouched);
    else if (event.code === 'KeyV') lab.toggleMode();
    else if (event.code === 'KeyL') lab.exit();
    else if (event.code === 'KeyB' && app.tabs) {
      if (document.pointerLockElement) document.exitPointerLock();
      app.tabs.select('build');
    }
  });

  // ----------------------------------------------------------- joystick tactile
  let stick = null;
  joystick.addEventListener('pointerdown', (event) => {
    stick = { id: event.pointerId };
    joystick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  joystick.addEventListener('pointermove', (event) => { if (stick && stick.id === event.pointerId) moveStick(event); });
  const release = () => { stick = null; knob.style.transform = ''; lab.setMove(0, 0); };
  joystick.addEventListener('pointerup', release);
  joystick.addEventListener('pointercancel', release);
  function moveStick(event) {
    const rect = joystick.getBoundingClientRect();
    const radius = rect.width / 2;
    let x = (event.clientX - rect.left - radius) / radius;
    let y = (event.clientY - rect.top - radius) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    lab.setMove(x, -y);
  }

  // ----------------------------------------------------------- états
  function paintMode(mode) {
    const on = !!mode;
    hud.hidden = !on;
    document.body.classList.toggle('in-lab', on);
    viewButton.textContent = on ? t('lab.exit') : t('lab.enter');
    viewButton.title = on ? t('lab.exitTitle') : t('lab.enterTitle');
    modeButton.hidden = !on;
    modeButton.textContent = mode === 'walk' ? t('lab.overview') : t('lab.walk');
    crosshair.hidden = mode !== 'walk';
    keys.textContent = touch ? t('lab.keysTouch') : t('lab.keys');
    keys.hidden = mode !== 'walk';
    joystick.hidden = mode !== 'walk';
    touchButtons.hidden = mode !== 'walk';
    paintResume();
    if (on && !welcomed && !(render.isPresenting && render.isPresenting())) showWelcome();
    if (!on) welcome.hidden = true;
  }
  function paintResume() {
    resume.hidden = touch || !lab.active || lab.mode !== 'walk' || document.pointerLockElement === render.domElement || !welcome.hidden;
  }
  document.addEventListener('pointerlockchange', paintResume);

  function showWelcome() {
    welcomed = true;
    welcome.replaceChildren(
      el('h2', {}, t('lab.welcomeTitle')),
      el('p', {}, t('lab.welcome')),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', class: 'btn btn-primary', id: 'lab-start', onclick: () => { welcome.hidden = true; paintResume(); } }, t('lab.start')),
        app.missions ? el('button', { type: 'button', class: 'btn', onclick: () => { welcome.hidden = true; paintResume(); app.missions.open(); } }, t('lab.missions')) : null));
    welcome.hidden = false;
  }

  function paintPoster() {
    const scenario = sim.scenario;
    if (scenario) lab.setPoster(localize(scenario.title) || '', localize(scenario.summary) || '');
  }

  lab.onMode(paintMode);
  paintMode(lab.active ? lab.mode : null); // libellé du bouton dès l'ouverture (mode classique avec ?classique)
  sim.on(Topics.SCENARIO_LOADED, paintPoster);
  onLangChange(() => {
    paintMode(lab.active ? lab.mode : null);
    resume.textContent = t('lab.resume');
    paintPoster();
    paintCard(lab.target);
  });
  // L'application s'ouvre dans le laboratoire, sauf avec `?classique` (ou `?classic`) dans l'adresse.
  const params = new URLSearchParams(window.location.search);
  if (!params.has('classique') && !params.has('classic')) {
    const open = () => { if (!lab.active) { lab.enter(); paintPoster(); } };
    if (sim.scenario) open();
    else { const off = sim.on(Topics.SCENARIO_LOADED, () => { off(); open(); }); }
  }
  paintPoster();
  return { hud, act, addFromCatalog, pickCable, get build() { return build; } };
}
