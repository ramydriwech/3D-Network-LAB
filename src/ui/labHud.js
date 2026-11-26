// Interface du laboratoire (S7) : le bouton « Laboratoire », le viseur, la fiche de ce que
// Steve regarde, l'aide des touches, le joystick tactile et l'accueil.
//
// La salle et la caméra sont dans src/render/lab.js ; ce fichier relie ce que Steve vise
// aux autres parties : sélection (panneau Équipement), consoles (terminal.js) et éditeur
// (pour poser un modèle pris sur l'étagère-catalogue).
//
// Touches : ZQSD / WASD marcher · souris regarder · clic sélectionner · E console ·
// V survol / marche · B construire · Échap libérer la souris · L quitter le labo.

import { Topics } from '../sim/events.js';
import { MODELS, CABLES, cableSummary, modelOf, systemOf } from '../sim/catalog.js';
import * as B from '../sim/builder.js';
import { el } from './dom.js';
import { localize, onLangChange, registerStrings, t } from './i18n.js';
import { hasConsole } from './terminal.js';
import { toast } from './toast.js';

registerStrings({
  fr: {
    'lab.enter': 'Laboratoire',
    'lab.enterTitle': 'Entrer dans le laboratoire (vue à la première personne)',
    'lab.exit': 'Quitter le labo',
    'lab.walk': 'Marcher',
    'lab.overview': 'Survol',
    'lab.resume': 'Cliquez dans la scène pour regarder autour de vous',
    'lab.keys': 'ZQSD / WASD : marcher · Souris : regarder · Clic : choisir · E : console · V : survol · B : construire · Échap : libérer la souris',
    'lab.keysTouch': 'Joystick : marcher · Glisser : regarder · Toucher : choisir',
    'lab.device': 'Clic : sélectionner · E : ouvrir la console',
    'lab.deviceTouch': 'Boutons « Console » et « Choisir »',
    'lab.deviceNoConsole': 'Clic : sélectionner · pas de console (non administrable)',
    'lab.catalog': 'Clic : poser ce modèle devant vous',
    'lab.os': '{os} · commandes {dialect}',
    'lab.added': '{model} installé devant vous : reliez-le avec l\'outil « Relier » de l\'onglet Construire.',
    'lab.cable': 'Clic : utiliser ce câble pour les prochains branchements',
    'lab.cableChosen': 'Câble choisi : {cable}. Les prochains branchements (outil « Relier », bouton « Câbler » en VR) l\'utiliseront.',
    'lab.welcomeTitle': 'Bienvenue au labo, Steve',
    'lab.welcome': 'Les switchs, routeurs, pare-feu et serveurs du scénario sont montés dans les baies ; les PC sont sur les postes de travail. Approchez-vous, visez un routeur, un switch ou un pare-feu et appuyez sur E pour ouvrir sa console. L\'étagère « Catalogue » contient tous les modèles et tous les câbles : cliquez sur un modèle pour l\'ajouter, sur un câble pour le choisir, puis câblez et configurez avec vos propres commandes.',
    'lab.start': 'Commencer',
    'lab.missions': 'Missions',
    'lab.console': 'Console',
    'lab.select': 'Choisir',
  },
  en: {
    'lab.enter': 'Laboratory',
    'lab.enterTitle': 'Enter the laboratory (first-person view)',
    'lab.exit': 'Leave the lab',
    'lab.walk': 'Walk',
    'lab.overview': 'Overview',
    'lab.resume': 'Click in the scene to look around',
    'lab.keys': 'WASD / ZQSD: walk · Mouse: look · Click: choose · E: console · V: overview · B: build · Esc: release the mouse',
    'lab.keysTouch': 'Joystick: walk · Drag: look · Tap: choose',
    'lab.device': 'Click: select · E: open the console',
    'lab.deviceTouch': '"Console" and "Choose" buttons',
    'lab.deviceNoConsole': 'Click: select · no console (unmanaged)',
    'lab.catalog': 'Click: place this model in front of you',
    'lab.os': '{os} · {dialect} commands',
    'lab.added': '{model} installed in front of you: connect it with the "Connect" tool in the Build tab.',
    'lab.cable': 'Click: use this cable for the next connections',
    'lab.cableChosen': 'Cable chosen: {cable}. The next connections ("Connect" tool, "Cable" button in VR) will use it.',
    'lab.welcomeTitle': 'Welcome to the lab, Steve',
    'lab.welcome': 'The scenario\'s switches, routers, firewalls and servers are mounted in the racks; the PCs sit on the workstations. Walk up to one, aim at a router, a switch or a firewall and press E to open its console. The "Catalogue" shelf holds every model and every cable: click a model to add it, a cable to choose it, then cable and configure with your own commands.',
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
  const slot = document.getElementById('xr-slot');
  if (!lab || !slot) return null;
  const sceneBox = document.getElementById('scene');
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let welcomed = false;

  // ----------------------------------------------------------- éléments
  const enterButton = el('button', { type: 'button', class: 'btn lab-button', id: 'lab-button', title: t('lab.enterTitle'), onclick: () => (lab.active ? lab.exit() : lab.enter()) }, t('lab.enter'));
  slot.before(enterButton);

  const crosshair = el('div', { class: 'lab-crosshair', 'aria-hidden': 'true' });
  const card = el('div', { class: 'lab-card', hidden: true, role: 'status' });
  const resume = el('div', { class: 'lab-resume', hidden: true }, t('lab.resume'));
  const keys = el('div', { class: 'lab-keys' });
  const modeButton = el('button', { type: 'button', class: 'btn', id: 'lab-mode', onclick: () => lab.toggleMode() });
  const exitButton = el('button', { type: 'button', class: 'btn', id: 'lab-exit', onclick: () => lab.exit() }, t('lab.exit'));
  const touchButtons = el('div', { class: 'lab-touch-actions' },
    el('button', { type: 'button', class: 'btn btn-primary', id: 'lab-touch-console', onclick: () => act('console') }, t('lab.console')),
    el('button', { type: 'button', class: 'btn', id: 'lab-touch-select', onclick: () => act('select') }, t('lab.select')));
  const knob = el('div', { class: 'lab-knob' });
  const joystick = el('div', { class: 'lab-joystick', 'aria-hidden': 'true' }, knob);
  const welcome = el('div', { class: 'lab-welcome', hidden: true, role: 'dialog' });
  const hud = el('div', { class: 'lab-hud', hidden: true },
    crosshair, card, resume, welcome,
    el('div', { class: 'lab-bar' }, modeButton, exitButton),
    keys,
    touch ? joystick : null,
    touch ? touchButtons : null);
  sceneBox.append(hud);

  // ----------------------------------------------------------- fiche de l'objet visé
  function paintCard(target) {
    if (!target || !lab.active) { card.hidden = true; return; }
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
    } else if (target.kind === 'cable') {
      const cable = CABLES[target.cable];
      title = cable.name;
      lines = [localize(cableSummary(target.cable)), localize(cable.description)];
      hint = t('lab.cable');
    }
    card.replaceChildren(el('strong', {}, title), ...lines.filter(Boolean).map((line) => el('p', {}, line)), el('p', { class: 'lab-hint' }, hint));
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
    if (!target) target = lastTouched;
    if (!target) return;
    if (target.kind === 'catalog') { addFromCatalog(target.type, target.model); return; }
    if (target.kind === 'cable') { pickCable(target.cable); return; }
    if (target.kind !== 'device') return;
    if (app.selection) app.selection.select({ kind: 'device', id: target.id });
    if (what === 'console' && app.terminals) {
      if (document.pointerLockElement) document.exitPointerLock();
      app.terminals.open(target.id);
    }
  }

  lab.onTarget(paintCard);
  let lastTouched = null;
  lab.onTap((hit) => {
    if (!hit) return;
    // Sur écran tactile, toucher un équipement le vise : la fiche et les boutons suivent.
    if (touch && hit.kind === 'device') { paintCard(hit); lastTouched = hit; }
    act('select', hit);
  });

  window.addEventListener('keydown', (event) => {
    if (!lab.active || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
    enterButton.classList.toggle('btn-primary', on);
    enterButton.textContent = on ? t('lab.exit') : t('lab.enter');
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
  sim.on(Topics.SCENARIO_LOADED, paintPoster);
  onLangChange(() => {
    enterButton.title = t('lab.enterTitle');
    paintMode(lab.active ? lab.mode : null);
    exitButton.textContent = t('lab.exit');
    resume.textContent = t('lab.resume');
    paintPoster();
    paintCard(lab.target);
  });
  // `?lab` dans l'adresse : on entre directement (pratique pour une démonstration).
  if (new URLSearchParams(window.location.search).has('lab')) {
    const off = sim.on(Topics.SCENARIO_LOADED, () => { off(); if (!lab.active) { lab.enter(); paintPoster(); } });
  }
  paintPoster();
  return { hud, act, addFromCatalog, pickCable };
}
