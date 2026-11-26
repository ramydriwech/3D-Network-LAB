// Panneau de contrôle visible en VR.
//
// Dans le casque, la page HTML disparaît : les boutons et les explications doivent donc
// exister dans la scène 3D. Le panneau est un rectangle dont la texture est un canevas 2D
// redessiné à chaque changement (état, explication, sélection). Un rayon qui touche le
// rectangle donne des coordonnées (u, v) : on en déduit le bouton visé.

import * as THREE from 'three';
import { Topics } from '../sim/events.js';
import { formatNote, localize, onLangChange, registerStrings, t } from '../ui/i18n.js';

const WIDTH = 1024;
const HEIGHT = 640;
const PANEL_WIDTH = 1.15; // mètres
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SPEEDS = [0.25, 0.5, 1, 2, 4];

registerStrings({
  fr: {
    'vr.play': 'Lecture', 'vr.pause': 'Pause', 'vr.step': 'Pas à pas', 'vr.reset': 'Réinit.', 'vr.exit': 'Quitter',
    'vr.hint': 'Visez un bouton, un équipement ou un paquet, puis appuyez sur la gâchette.',
    'vr.state.ready': 'Prêt', 'vr.state.playing': 'Lecture', 'vr.state.paused': 'En pause', 'vr.state.finished': 'Terminé',
  },
  en: {
    'vr.play': 'Play', 'vr.pause': 'Pause', 'vr.step': 'Step', 'vr.reset': 'Reset', 'vr.exit': 'Exit',
    'vr.hint': 'Aim at a button, a device or a packet, then pull the trigger.',
    'vr.state.ready': 'Ready', 'vr.state.playing': 'Playing', 'vr.state.paused': 'Paused', 'vr.state.finished': 'Finished',
  },
});

/** Rectangles des boutons, en pixels du canevas. */
const BUTTONS = [
  { id: 'toggle', x: 24, w: 212 },
  { id: 'step', x: 248, w: 212 },
  { id: 'reset', x: 472, w: 180 },
  { id: 'speed', x: 664, w: 150 },
  { id: 'exit', x: 826, w: 174 },
].map((button) => ({ ...button, y: HEIGHT - 124, h: 100 }));

/** Découpe un texte en lignes qui tiennent dans `maxWidth`. */
function wrap(context, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {Object} app     { sim, render }
 * @param {Function} exit  appelé par le bouton « Quitter »
 */
export function createVRPanel(app, exit) {
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
  // À gauche de l'utilisateur, à hauteur des yeux, tourné vers lui.
  object.position.set(-1.05, 1.35, -1.2);
  object.rotation.y = Math.atan2(1.05, 1.2);
  object.name = 'vr-panel';

  let message = null;  // dernière explication de la simulation
  let detail = null;   // lignes décrivant l'objet sélectionné
  let hovered = null;  // bouton survolé par un rayon

  const label = (id) => {
    if (id === 'toggle') return t(sim.can('pause') ? 'vr.pause' : 'vr.play');
    if (id === 'speed') return `×${sim.speed}`;
    return t('vr.' + id);
  };
  const enabled = (id) => {
    if (id === 'toggle') return sim.can('pause') || sim.can('play');
    if (id === 'step') return sim.can('step');
    return true;
  };

  function draw() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = 'rgba(11, 18, 32, 0.94)';
    context.beginPath();
    context.roundRect(0, 0, WIDTH, HEIGHT, 28);
    context.fill();
    context.strokeStyle = '#38bdf8';
    context.lineWidth = 4;
    context.stroke();

    // En-tête : titre du scénario, état et temps simulé.
    context.textBaseline = 'top';
    context.textAlign = 'left';
    context.fillStyle = '#f1f5f9';
    context.font = `600 40px ${FONT}`;
    context.fillText(sim.scenario ? localize(sim.scenario.title) : '3D Network Topology', 32, 26, WIDTH - 330);
    context.textAlign = 'right';
    context.fillStyle = '#7dd3fc';
    context.font = `32px ${FONT}`;
    context.fillText(`${t('vr.state.' + sim.state)} · ${(sim.now / 1000).toFixed(1)} s`, WIDTH - 32, 32);

    // Corps : l'explication courante, puis l'objet sélectionné.
    context.textAlign = 'left';
    context.font = `30px ${FONT}`;
    context.fillStyle = '#e2e8f0';
    let y = 96;
    const text = message ? formatNote(sim, message) : t('vr.hint');
    for (const line of wrap(context, text, WIDTH - 64).slice(0, detail ? 5 : 9)) {
      context.fillText(line, 32, y);
      y += 40;
    }
    if (detail) {
      y = Math.max(y + 12, 318);
      context.fillStyle = '#1e293b';
      context.beginPath();
      context.roundRect(24, y - 10, WIDTH - 48, HEIGHT - 150 - y + 10, 14);
      context.fill();
      context.font = `26px ui-monospace, Menlo, Consolas, monospace`;
      detail.slice(0, 5).forEach((line, index) => {
        context.fillStyle = index === 0 ? '#fde68a' : '#cbd5e1';
        context.fillText(line, 40, y + index * 34, WIDTH - 80);
      });
    }

    // Pied : les boutons.
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const button of BUTTONS) {
      const active = enabled(button.id);
      context.fillStyle = !active ? '#1e293b' : hovered === button.id ? '#0ea5e9' : button.id === 'exit' ? '#7f1d1d' : '#1d4ed8';
      context.beginPath();
      context.roundRect(button.x, button.y, button.w, button.h, 18);
      context.fill();
      context.fillStyle = active ? '#ffffff' : '#64748b';
      context.font = `600 34px ${FONT}`;
      context.fillText(label(button.id), button.x + button.w / 2, button.y + button.h / 2, button.w - 16);
    }
    texture.needsUpdate = true;
  }

  /** Lignes décrivant l'équipement ou le paquet sélectionné. */
  function describe(event) {
    if (event.kind === 'device') {
      const device = sim.device(event.id);
      if (!device) return null;
      return [device.name, ...device.interfaces.filter((iface) => iface.mac || iface.ip)
        .map((iface) => `${iface.name}  ${iface.ip ? iface.ip + '/' + iface.prefix : '—'}  ${iface.mac || ''}`)];
    }
    if (event.kind === 'packet') {
      const packet = event.packet;
      const lines = [packet.label, `MAC  ${packet.eth.src} → ${packet.eth.dst}`];
      if (packet.ip) lines.push(`IP   ${packet.ip.src} → ${packet.ip.dst}   TTL ${packet.ip.ttl}`);
      if (packet.tcp) lines.push(`TCP  ${packet.tcp.srcPort} → ${packet.tcp.dstPort}  [${packet.tcp.flags.join(',')}] seq=${packet.tcp.seq} ack=${packet.tcp.ack}`);
      if (packet.udp) lines.push(`UDP  ${packet.udp.srcPort} → ${packet.udp.dstPort}`);
      if (packet.arp) lines.push(`ARP  ${packet.arp.op}  ${packet.arp.senderIp} → ${packet.arp.targetIp}`);
      return lines;
    }
    return null;
  }

  const unsubscribe = [
    sim.on(Topics.STATE, draw),
    sim.on(Topics.SPEED, draw),
    sim.on(Topics.PACKET_SEND, (event) => { if (event.notes[0]) { message = event.notes[0]; draw(); } }),
    sim.on(Topics.NOTE, (event) => { if (event.notes[0]) { message = event.notes[0]; draw(); } }),
    sim.on(Topics.RESET, () => { message = null; detail = null; draw(); }),
    sim.on(Topics.SCENARIO_LOADED, draw),
    sim.on(Topics.SELECT, (event) => { detail = describe(event); draw(); }),
    onLangChange(draw),
  ];
  // Le temps affiché est rafraîchi deux fois par seconde, pas à chaque image.
  let shownTime = -1;
  const offFrame = app.render.onFrame(() => {
    const half = Math.floor(sim.now / 500);
    if (half !== shownTime) { shownTime = half; draw(); }
  });

  const panel = {
    object,
    /** Bouton situé aux coordonnées de texture (u, v), ou null. */
    buttonAt(uv) {
      const x = uv.x * WIDTH;
      const y = (1 - uv.y) * HEIGHT;
      const button = BUTTONS.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      return button ? button.id : null;
    },
    /** Intersection d'un rayon avec le panneau : { distance, button } ou null. */
    intersect(raycaster) {
      const hit = raycaster.intersectObject(object, false)[0];
      return hit ? { distance: hit.distance, point: hit.point, button: panel.buttonAt(hit.uv) } : null;
    },
    hover(id) {
      if (id !== hovered) { hovered = id; draw(); }
    },
    /** Exécute le bouton : mêmes commandes que l'interface HTML. */
    press(id) {
      if (id === 'toggle') sim.execute('toggle');
      else if (id === 'step') sim.execute('step');
      else if (id === 'reset') sim.execute('reset');
      else if (id === 'speed') sim.execute('speed', SPEEDS[(SPEEDS.indexOf(sim.speed) + 1) % SPEEDS.length]);
      else if (id === 'exit') exit();
      draw();
    },
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
