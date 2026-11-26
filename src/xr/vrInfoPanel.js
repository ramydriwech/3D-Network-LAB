// Second panneau VR, à droite : explications, fiche technique et diagnostic
// (demande du superviseur : les nouveautés doivent aussi exister dans le casque).
//
// Trois onglets en haut du panneau :
//   - Étape      : titre et explication de l'étape en cours du scénario ;
//   - Fiche      : modèle, caractéristiques et ports en direct de l'équipement visé ;
//   - Diagnostic : les constats les plus graves et un bouton pour corriger le premier.
// Comme le panneau de commandes, c'est un canevas 2D plaqué sur un rectangle.

import * as THREE from 'three';
import { Topics } from '../sim/events.js';
import { describeFix } from '../sim/diagnostic.js';
import { portRows, sheetFacts } from '../ui/datasheet.js';
import { localize, onLangChange, registerStrings, t } from '../ui/i18n.js';

const WIDTH = 1024;
const HEIGHT = 720;
const PANEL_WIDTH = 1.15; // mètres
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const TABS = ['step', 'sheet', 'diag'];
const SEVERITY_COLORS = { error: '#f87171', warning: '#fbbf24', info: '#38bdf8' };

registerStrings({
  fr: {
    'vri.step': 'Étape', 'vri.sheet': 'Fiche', 'vri.diag': 'Diagnostic',
    'vri.noStep': 'Lancez la lecture : l\'explication de chaque étape s\'affiche ici.',
    'vri.noDevice': 'Visez un équipement avec la manette et appuyez sur la gâchette pour voir sa fiche.',
    'vri.healthy': 'Aucun problème : le réseau est sain.',
    'vri.fix': 'Corriger : {what}',
    'vri.more': '… et {n} autre(s) constat(s) dans l\'onglet Diagnostic de la page.',
  },
  en: {
    'vri.step': 'Step', 'vri.sheet': 'Datasheet', 'vri.diag': 'Diagnostic',
    'vri.noStep': 'Start playback: each step\'s explanation shows here.',
    'vri.noDevice': 'Aim at a device with the controller and pull the trigger to see its datasheet.',
    'vri.healthy': 'No problem: the network is healthy.',
    'vri.fix': 'Fix: {what}',
    'vri.more': '… and {n} more finding(s) in the page\'s Diagnostic tab.',
  },
});

const TAB_BUTTONS = TABS.map((id, i) => ({ id: `tab:${id}`, x: 24 + i * 330, y: 20, w: 310, h: 78 }));
const FIX_BUTTON = { id: 'fix', x: 24, y: HEIGHT - 110, w: WIDTH - 48, h: 86 };

function wrap(context, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export function createVRInfoPanel(app) {
  const { sim } = app;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_WIDTH * HEIGHT / WIDTH);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const object = new THREE.Mesh(geometry, material);
  // À droite de l'utilisateur, symétrique du panneau de commandes.
  object.position.set(1.05, 1.35, -1.2);
  object.rotation.y = -Math.atan2(1.05, 1.2);
  object.name = 'vr-info-panel';

  let tab = 'step';
  let step = null;
  let deviceId = null;
  let hovered = null;

  const report = () => (app.diagnostic && app.diagnostic.report) || null;
  const firstFix = () => { const r = report(); return r ? r.findings.find((f) => f.fix) || null : null; };

  function text(lines, x, y, { font = `30px ${FONT}`, color = '#e2e8f0', step: lineStep = 40, max = 20, width = WIDTH - 64 } = {}) {
    context.font = font;
    context.fillStyle = color;
    let count = 0;
    for (const line of lines) {
      for (const part of wrap(context, line, width)) {
        if (count++ >= max) return y;
        context.fillText(part, x, y, width);
        y += lineStep;
      }
    }
    return y;
  }

  function drawStep() {
    if (!step) return text([t('vri.noStep')], 32, 130);
    let y = text([localize(step.title) || '—'], 32, 130, { font: `600 34px ${FONT}`, color: '#fde68a' });
    return text([localize(step.explanation) || ''], 32, y + 12, { max: 12 });
  }

  function drawSheet() {
    const device = deviceId && sim.device(deviceId);
    if (!device) return text([t('vri.noDevice')], 32, 130);
    let y = text([device.name], 32, 130, { font: `600 36px ${FONT}`, color: '#fde68a' });
    for (const [label, value] of sheetFacts(device.def || {}).slice(0, 5)) {
      context.font = `26px ${FONT}`;
      context.fillStyle = '#93a3bd';
      context.fillText(label, 32, y + 8, 360);
      context.fillStyle = '#e2e8f0';
      context.fillText(String(value), 400, y + 8, WIDTH - 432);
      y += 38;
    }
    y += 14;
    const rows = sim.network ? portRows(sim, device) : [];
    for (const row of rows.slice(0, 6)) {
      context.fillStyle = row.load >= 0.8 ? '#f87171' : row.load >= 0.5 ? '#fbbf24' : '#cbd5e1';
      context.font = `24px ${MONO}`;
      context.fillText(`${row.port.padEnd(5)} ${row.speed.padEnd(9)} ↑${row.tx.padEnd(10)} ↓${row.rx.padEnd(10)} ${row.peer}`, 32, y, WIDTH - 64);
      y += 34;
    }
    return y;
  }

  function drawDiag() {
    const r = report();
    if (!r) return text([t('vri.noStep')], 32, 130);
    if (r.healthy && !r.findings.some((f) => f.severity !== 'info' || f.rule !== 'summary')) return text([t('vri.healthy')], 32, 130, { color: '#4ade80' });
    let y = 130;
    const shown = r.findings.slice(0, 3);
    for (const finding of shown) {
      context.fillStyle = SEVERITY_COLORS[finding.severity];
      context.fillRect(28, y + 4, 10, 34);
      y = text([localize(finding.title)], 52, y + 6, { font: `600 30px ${FONT}`, max: 2, width: WIDTH - 90 });
      y = text([localize(finding.advice)], 52, y, { font: `25px ${FONT}`, color: '#cbd5e1', step: 33, max: 3, width: WIDTH - 90 }) + 10;
    }
    if (r.findings.length > shown.length) text([t('vri.more', { n: r.findings.length - shown.length })], 32, y, { font: `24px ${FONT}`, color: '#93a3bd' });
    return y;
  }

  function draw() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = 'rgba(11, 18, 32, 0.94)';
    context.beginPath();
    context.roundRect(0, 0, WIDTH, HEIGHT, 28);
    context.fill();
    context.strokeStyle = '#a78bfa';
    context.lineWidth = 4;
    context.stroke();
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    for (const button of TAB_BUTTONS) {
      const id = button.id.slice(4);
      context.fillStyle = id === tab ? '#7c3aed' : hovered === button.id ? '#4c1d95' : '#1e293b';
      context.beginPath();
      context.roundRect(button.x, button.y, button.w, button.h, 16);
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = `600 32px ${FONT}`;
      let label = t('vri.' + id);
      const r = report();
      if (id === 'diag' && r) { const urgent = r.counts.error + r.counts.warning; if (urgent) label += ` (${urgent})`; }
      context.fillText(label, button.x + button.w / 2, button.y + button.h / 2, button.w - 20);
    }
    context.textAlign = 'left';
    context.textBaseline = 'top';
    if (tab === 'step') drawStep();
    if (tab === 'sheet') drawSheet();
    if (tab === 'diag') {
      drawDiag();
      const fix = firstFix();
      if (fix) {
        context.fillStyle = hovered === 'fix' ? '#0ea5e9' : '#0369a1';
        context.beginPath();
        context.roundRect(FIX_BUTTON.x, FIX_BUTTON.y, FIX_BUTTON.w, FIX_BUTTON.h, 18);
        context.fill();
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#ffffff';
        context.font = `600 32px ${FONT}`;
        context.fillText(t('vri.fix', { what: localize(describeFix(fix.fix)) }), WIDTH / 2, FIX_BUTTON.y + FIX_BUTTON.h / 2, FIX_BUTTON.w - 30);
      }
    }
    texture.needsUpdate = true;
  }

  const unsubscribe = [
    sim.on(Topics.STEP, (event) => { step = event.step; draw(); }),
    sim.on(Topics.RESET, () => { step = null; draw(); }),
    sim.on(Topics.SCENARIO_LOADED, () => { step = null; draw(); }),
    sim.on(Topics.SELECT, (event) => { if (event.kind === 'device') { deviceId = event.id; tab = 'sheet'; draw(); } }),
    sim.on(Topics.DEVICE_UPDATE, (event) => { if (tab === 'sheet' && event.device === deviceId) draw(); }),
    sim.on(Topics.FINISHED, draw),
    onLangChange(draw),
  ];
  // Les débits de la fiche changent pendant la lecture : on redessine deux fois par seconde.
  let elapsed = 0;
  const offFrame = app.render.onFrame((dt) => {
    elapsed += dt;
    if (elapsed < 500 || tab !== 'sheet' || sim.state !== 'playing') return;
    elapsed = 0;
    draw();
  });

  const panel = {
    object,
    buttonAt(uv) {
      const x = uv.x * WIDTH;
      const y = (1 - uv.y) * HEIGHT;
      const inside = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      const button = TAB_BUTTONS.find(inside);
      if (button) return button.id;
      if (tab === 'diag' && firstFix() && inside(FIX_BUTTON)) return 'fix';
      return null;
    },
    intersect(raycaster) {
      const hit = raycaster.intersectObject(object, false)[0];
      return hit ? { distance: hit.distance, point: hit.point, button: panel.buttonAt(hit.uv) } : null;
    },
    hover(id) { if (id !== hovered) { hovered = id; draw(); } },
    press(id) {
      if (id && id.startsWith('tab:')) tab = id.slice(4);
      else if (id === 'fix') {
        const fix = firstFix();
        if (fix && app.diagnostic) app.diagnostic.fix(fix.fix).then(draw);
      }
      draw();
    },
    get tab() { return tab; },
    dispose() {
      for (const off of unsubscribe) off();
      offFrame();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
  draw();
  return panel;
}

/**
 * Regroupe plusieurs panneaux derrière la même interface (intersect / hover / press) :
 * les manettes visent ainsi indifféremment l'un ou l'autre.
 */
export function combinePanels(panels) {
  let last = null;
  return {
    panels,
    intersect(raycaster) {
      let best = null;
      for (const [index, panel] of panels.entries()) {
        const hit = panel.intersect(raycaster);
        if (hit && (!best || hit.distance < best.distance)) best = { ...hit, button: hit.button ? `${index}|${hit.button}` : null };
      }
      return best;
    },
    hover(id) {
      if (id === last) return;
      last = id;
      const [index, button] = id ? id.split('|') : [null, null];
      panels.forEach((panel, i) => panel.hover(String(i) === index ? button : null));
    },
    press(id) {
      const [index, button] = id.split('|');
      panels[Number(index)].press(button);
    },
  };
}
