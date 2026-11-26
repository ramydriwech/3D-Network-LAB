// Console en VR (S7) : l'écran du terminal de l'équipement choisi et un clavier 3D, posés
// devant Steve comme un pupitre. On vise une touche avec une manette et on appuie sur la
// gâchette ; des « raccourcis » proposent les commandes les plus courantes du système de
// l'équipement (IOS, VRP ou invite de commandes du PC) pour éviter de tout taper.
//
// Les sessions sont celles de src/ui/terminal.mjs : ce qui est tapé dans le casque se
// retrouve dans la fenêtre de console à la sortie de la VR, et inversement.
//
// Le bouton « Câbler » sert à relier deux équipements avec la manette : on vise le premier,
// puis le second ; le câble est ajouté au brouillon de l'éditeur.

import * as THREE from 'three';
import { Topics } from '../sim/events.mjs';
import * as B from '../sim/builder.mjs';
import { localize, onLangChange, registerStrings, t } from '../ui/i18n.mjs';
import { hasConsole } from '../ui/terminal.mjs';

registerStrings({
  fr: {
    'vrc.title': 'Console', 'vrc.none': 'Visez un routeur, un switch, un pare-feu ou un PC et appuyez sur la gâchette : sa console s\'ouvre ici.',
    'vrc.cable': 'Câbler', 'vrc.cableOn': 'Câblage : visez le 1er équipement', 'vrc.cableSecond': 'Câblage : {name} → visez le 2nd',
    'vrc.cabled': 'Câble ajouté : {a} ↔ {b}', 'vrc.close': 'Fermer', 'vrc.space': 'Espace', 'vrc.enter': 'Entrée',
    'vrc.unmanaged': '{name} n\'a pas de console (switch non administrable).',
  },
  en: {
    'vrc.title': 'Console', 'vrc.none': 'Aim at a router, a switch, a firewall or a PC and pull the trigger: its console opens here.',
    'vrc.cable': 'Cable', 'vrc.cableOn': 'Cabling: aim at the 1st device', 'vrc.cableSecond': 'Cabling: {name} → aim at the 2nd',
    'vrc.cabled': 'Cable added: {a} ↔ {b}', 'vrc.close': 'Close', 'vrc.space': 'Space', 'vrc.enter': 'Enter',
    'vrc.unmanaged': '{name} has no console (unmanaged switch).',
  },
});

const SIZE = 1024;
const PANEL_WIDTH = 0.9; // m
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const SCREEN = { x: 16, y: 72, w: SIZE - 32, h: 440 };
const SCREEN_LINES = 16;

/** Raccourcis par style de commandes (le texte se termine par une espace : on complète ensuite). */
const CHIPS = {
  ios: ['enable', 'configure terminal', 'show running-config', 'show ip interface brief', 'show ip route', 'show vlan brief', 'interface ', 'ip address ', 'no shutdown', 'exit', 'end', 'ping '],
  vrp: ['system-view', 'display current-configuration', 'display ip interface brief', 'display ip routing-table', 'display vlan', 'interface ', 'ip address ', 'undo shutdown', 'quit', 'return', 'ping ', 'tracert '],
  pc: ['ipconfig', 'ipconfig /all', 'ipconfig /renew', 'arp -a', 'ping ', 'tracert ', 'nslookup ', 'curl ', 'cls', 'help'],
};

/** Clavier : rangées de touches (largeur relative). */
const ROWS = [
  [...'1234567890'].concat(['-', '.', '/']).map((k) => ({ k })),
  [...'qwertyuiop'].concat([':']).map((k) => ({ k })),
  [...'asdfghjkl'].concat(['?', '⌫']).map((k) => ({ k, w: k === '⌫' ? 1.5 : 1 })),
  [{ k: '⇧', w: 1.5 }].concat([...'zxcvbnm'].map((k) => ({ k })), [{ k: ',' }, { k: '"' }, { k: '_' }]),
  [{ k: 'Tab', w: 1.4 }, { k: ' ', w: 4.6 }, { k: '↑' }, { k: '↓' }, { k: '⏎', w: 2.2 }],
];

/** Calcule les rectangles (pixels du canevas) des boutons : en-tête, raccourcis, touches. */
function layout(chips) {
  const buttons = [];
  buttons.push({ id: 'cable', x: SIZE - 336, y: 12, w: 160, h: 50 }, { id: 'close', x: SIZE - 168, y: 12, w: 152, h: 50 });
  const chipTop = SCREEN.y + SCREEN.h + 10;
  const perRow = 6;
  const chipW = (SIZE - 32 - (perRow - 1) * 8) / perRow;
  chips.slice(0, 12).forEach((text, i) => {
    buttons.push({ id: `chip:${i}`, text, x: 16 + (i % perRow) * (chipW + 8), y: chipTop + Math.floor(i / perRow) * 50, w: chipW, h: 42 });
  });
  const keyTop = chipTop + 112;
  const keyH = (SIZE - keyTop - 16) / ROWS.length;
  ROWS.forEach((row, r) => {
    const units = row.reduce((sum, key) => sum + (key.w || 1), 0);
    const unit = (SIZE - 32 - (row.length - 1) * 8) / units;
    let x = 16;
    for (const key of row) {
      const w = unit * (key.w || 1);
      buttons.push({ id: `key:${key.k}`, key: key.k, x, y: keyTop + r * keyH, w, h: keyH - 8 });
      x += w + 8;
    }
  });
  return buttons;
}

export function createVRConsole(app) {
  const { sim } = app;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_WIDTH);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const object = new THREE.Mesh(geometry, material);
  // Devant Steve, un peu bas, incliné comme un pupitre.
  object.position.set(0, 1.02, -0.62);
  object.rotation.x = -0.62;
  object.name = 'vr-console';

  let current = null; // id de l'équipement dont la console est affichée
  let shift = false;
  let hovered = null;
  let cabling = null; // null | { first: id | null }
  let notice = null;
  let buttons = layout([]);

  const session = () => (current && app.terminals ? app.terminals.session(current) : null);
  const nameOf = (id) => { const d = sim.scenario && sim.scenario.devices.find((x) => x.id === id); return d ? d.name : id; };

  function chipsFor() {
    const s = session();
    return s ? CHIPS[s.con.dialect] || CHIPS.ios : [];
  }

  function draw() {
    buttons = layout(chipsFor());
    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = 'rgba(8, 15, 10, 0.94)';
    roundRect(0, 0, SIZE, SIZE, 28); g.fill();
    g.strokeStyle = '#2f6f3f'; g.lineWidth = 4; roundRect(2, 2, SIZE - 4, SIZE - 4, 26); g.stroke();
    // En-tête
    const s = session();
    g.fillStyle = '#bbf7d0'; g.font = `bold 34px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(s ? `>_ ${s.name}` : `>_ ${t('vrc.title')}`, 24, 38);
    // Écran
    g.fillStyle = '#020702'; roundRect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, 12); g.fill();
    g.font = `25px ${MONO}`; g.textBaseline = 'top';
    if (!s) {
      g.fillStyle = '#86efac'; g.font = `30px ${FONT}`;
      wrap(notice || t('vrc.none'), SCREEN.w - 40).forEach((line, i) => g.fillText(line, SCREEN.x + 20, SCREEN.y + 24 + i * 40));
    } else {
      const lines = s.lines.slice(-(SCREEN_LINES - 1));
      lines.forEach((line, i) => {
        g.fillStyle = line.kind === 'error' ? '#fca5a5' : line.kind === 'cmd' ? '#f0fdf4' : line.kind === 'muted' ? '#6f9b6f' : '#a7f3a7';
        g.fillText(clip(line.text, SCREEN.w - 24), SCREEN.x + 12, SCREEN.y + 10 + i * 26.5);
      });
      g.fillStyle = '#f0fdf4';
      g.fillText(clip(`${s.prompt}${s.input}▌`, SCREEN.w - 24, true), SCREEN.x + 12, SCREEN.y + 10 + lines.length * 26.5);
      if (notice) { g.fillStyle = '#fbbf24'; g.font = `24px ${FONT}`; g.fillText(notice, SCREEN.x + 12, SCREEN.y + SCREEN.h - 34); }
    }
    // Boutons
    for (const button of buttons) {
      const isHover = hovered === button.id;
      let label = button.text || button.key || '';
      let fill = '#1f2937';
      if (button.id === 'cable') { label = cabling ? (cabling.first ? '…' : '…') : t('vrc.cable'); fill = cabling ? '#b45309' : '#1e3a8a'; }
      if (button.id === 'close') { label = t('vrc.close'); fill = '#7f1d1d'; }
      if (button.id.startsWith('chip:')) fill = '#14532d';
      if (button.key) {
        if (button.key === ' ') label = t('vrc.space');
        else if (button.key === '⏎') label = t('vrc.enter');
        else if (button.key === '⇧') fill = shift ? '#0369a1' : fill;
        else if (button.key.length === 1 && shift) label = button.key.toUpperCase();
        if (!s) fill = '#111827';
      }
      g.fillStyle = isHover ? '#0ea5e9' : fill;
      roundRect(button.x, button.y, button.w, button.h, 10); g.fill();
      g.fillStyle = '#f8fafc';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = button.id.startsWith('chip:') ? `22px ${MONO}` : button.key && button.key.length === 1 ? `bold 34px ${MONO}` : `bold 26px ${FONT}`;
      g.fillText(clip(label.trim() || label, button.w - 12), button.x + button.w / 2, button.y + button.h / 2);
      g.textAlign = 'left';
    }
    if (cabling) {
      g.fillStyle = '#fbbf24'; g.font = `bold 24px ${FONT}`; g.textBaseline = 'middle';
      g.fillText(cabling.first ? t('vrc.cableSecond', { name: nameOf(cabling.first) }) : t('vrc.cableOn'), 360, 38);
    }
    texture.needsUpdate = true;
    // Le pupitre n'apparaît que lorsqu'une console (ou un câblage) est en cours : sinon il
    // masquerait les équipements que l'on vise devant soi.
    object.visible = !!(s || cabling || notice);
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function clip(text, max, keepEnd = false) {
    if (g.measureText(text).width <= max) return text;
    let out = text;
    while (out.length > 1 && g.measureText(`…${out}`).width > max) out = keepEnd ? out.slice(1) : out.slice(0, -1);
    return keepEnd ? `…${out}` : `${out}…`;
  }
  function wrap(text, max) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > max && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Ouvre la console d'un équipement dans le casque. */
  function open(id) {
    const def = sim.scenario && sim.scenario.devices.find((d) => d.id === id);
    if (!def) return;
    if (!hasConsole(def)) { notice = t('vrc.unmanaged', { name: def.name }); current = null; draw(); return; }
    notice = null;
    if (app.terminals) app.terminals.open(id, { show: false });
    current = id;
    draw();
  }

  /** Relie deux équipements (via l'éditeur, comme l'outil « Relier »). */
  function cable(a, b) {
    if (!app.editor) return;
    // Le câble choisi (étagère « Équipements » ou onglet Construire) ; Cat 6 par défaut.
    const link = (draft) => B.addLink(draft, a, b, app.editor && app.editor.cable ? { cable: app.editor.cable } : {}).draft;
    try {
      if (!app.editor.active) app.editor.start(link(B.draftFrom(sim.scenario)));
      else app.editor.change(link);
      notice = t('vrc.cabled', { a: nameOf(a), b: nameOf(b) });
    } catch (error) {
      notice = error.text ? localize(error.text) : error.message;
    }
  }

  function press(id) {
    const s = session();
    if (id === 'cable') { cabling = cabling ? null : { first: null }; notice = null; draw(); return; }
    if (id === 'close') { current = null; cabling = null; notice = null; draw(); return; }
    if (!s) return;
    notice = null;
    if (id.startsWith('chip:')) {
      const text = buttons.find((b) => b.id === id).text;
      if (text.endsWith(' ')) s.input = text; // à compléter (adresse, interface…)
      else s.submit(text);
    } else if (id.startsWith('key:')) {
      const key = id.slice(4);
      if (key === '⏎') s.submit(s.input);
      else if (key === '⌫') s.input = s.input.slice(0, -1);
      else if (key === '⇧') shift = !shift;
      else if (key === 'Tab') s.complete();
      else if (key === '↑') s.historyStep(-1);
      else if (key === '↓') s.historyStep(1);
      else if (key === '?' && s.con.dialect !== 'pc') s.help();
      else {
        s.input += shift ? key.toUpperCase() : key;
        if (shift && key.length === 1) shift = false; // majuscule pour une seule lettre
      }
    }
    draw();
  }

  // Une sélection à la manette : console de l'équipement, ou étape du câblage.
  const offSelect = sim.on(Topics.SELECT, (event) => {
    if (event.kind !== 'device') return;
    if (cabling) {
      if (!cabling.first) cabling.first = event.id;
      else if (cabling.first !== event.id) { const first = cabling.first; cabling = null; cable(first, event.id); }
      draw();
      return;
    }
    open(event.id);
  });
  const offChange = app.terminals ? app.terminals.onChange((id) => { if (id === current) draw(); }) : () => {};
  const offLang = onLangChange(draw);
  const offLoad = sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => {
    if (current && !scenario.devices.some((d) => d.id === current)) current = null;
    draw();
  });

  const uv = new THREE.Vector2();
  draw();
  return {
    object,
    get current() { return current; },
    get cabling() { return cabling; },
    open,
    press,
    /** Tape un texte comme au clavier (tests et démonstrations). */
    type(text) { for (const ch of text) press(`key:${ch === ' ' ? ' ' : ch.toLowerCase() === ch ? ch : (shift = true, ch.toLowerCase())}`); },
    intersect(raycaster) {
      if (!object.visible) return null;
      const hit = raycaster.intersectObject(object, false)[0];
      if (!hit || !hit.uv) return null;
      uv.copy(hit.uv);
      const x = uv.x * SIZE; const y = (1 - uv.y) * SIZE;
      const button = buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      return { distance: hit.distance, button: button ? button.id : null };
    },
    hover(id) { if (id !== hovered) { hovered = id; draw(); } },
    dispose() {
      offSelect(); offChange(); offLoad();
      if (typeof offLang === 'function') offLang();
      geometry.dispose(); material.dispose(); texture.dispose();
    },
  };
}
