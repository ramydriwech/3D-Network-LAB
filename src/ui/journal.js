// Journal des messages échangés : une ligne par trajet de paquet sur un câble.
// Cliquer sur une ligne ouvre le paquet dans l'inspecteur.

import { Topics } from '../sim/events.js';
import { el, panelTitle } from './dom.js';
import { applyI18n, localize, onLangChange, registerStrings, t } from './i18n.js';

const MAX_LINES = 400;

registerStrings({
  fr: {
    'log.title': 'Journal des messages',
    'log.empty': 'Aucun message pour l\'instant.',
    'log.legend': 'Couleurs des protocoles',
    'log.shapes': 'Chaque paquet est une carte : type de message, puis qui parle à qui ; le point lumineux montre sa position sur le câble ; un clic ouvre ses champs.',
    'log.dropped': 'détruit par {name}',
    'log.open': 'Ouvrir dans l\'inspecteur',
  },
  en: {
    'log.title': 'Message log',
    'log.empty': 'No message yet.',
    'log.legend': 'Protocol colours',
    'log.shapes': 'Each packet is a card: the message type, then who talks to whom; the glowing dot shows where it is on the cable; click it to see its fields.',
    'log.dropped': 'discarded by {name}',
    'log.open': 'Open in the inspector',
  },
});

export function initJournal(app, slot = document.getElementById('journal')) {
  const { sim, render } = app;
  const lines = []; // { kind: 'send' | 'drop' | 'step', … }
  const list = el('ol', { class: 'log' });
  const legend = el('details', { class: 'legend' });

  const name = (id) => (sim.device(id) ? sim.device(id).name : id);
  const time = (ms) => (ms / 1000).toFixed(1) + ' s';

  function lineElement(line) {
    if (line.kind === 'step') {
      return el('li', { class: 'log-step' }, localize(line.step.title) || '—');
    }
    const color = render.packetColor(line.packet);
    if (line.kind === 'drop') {
      return el('li', { class: 'log-drop' },
        el('span', { class: 'log-time' }, time(line.time)),
        el('span', { class: 'chip', style: `background:${color}` }),
        el('span', {}, `${line.packet.label} — ${t('log.dropped', { name: name(line.device) })}`));
    }
    return el('li', {},
      el('button', {
        type: 'button', class: 'log-line', title: t('log.open'),
        onclick: () => sim.bus.emit(Topics.SELECT, { kind: 'packet', packet: line.packet }),
      },
      el('span', { class: 'log-time' }, time(line.time)),
      el('span', { class: 'chip', style: `background:${color}` }),
      el('span', { class: 'log-path' }, `${name(line.from)} → ${name(line.to)}`),
      el('span', { class: 'log-label' }, line.packet.label)));
  }

  function drawLegend() {
    const items = render.legend();
    legend.replaceChildren(
      el('summary', {}, t('log.legend')),
      el('ul', { class: 'legend-list' }, items.map((item) => el('li', {}, el('span', { class: 'chip', style: `background:${item.color}` }), item.name))),
      el('p', { class: 'muted small' }, t('log.shapes')),
    );
    legend.hidden = items.length === 0;
  }

  function drawAll() {
    list.replaceChildren(...lines.map(lineElement));
    if (!lines.length) list.append(el('li', { class: 'muted log-empty' }, t('log.empty')));
    drawLegend();
    applyI18n(slot);
  }

  function push(line) {
    if (!lines.length) list.replaceChildren();
    lines.push(line);
    list.append(lineElement(line));
    if (lines.length > MAX_LINES) { lines.shift(); list.firstChild.remove(); }
    list.scrollTop = list.scrollHeight;
  }

  slot.replaceChildren(panelTitle('log.title'), legend, list);
  sim.on(Topics.PACKET_SEND, (event) => push({ kind: 'send', time: event.time, from: event.from, to: event.to, packet: event.packet }));
  sim.on(Topics.PACKET_DROP, (event) => push({ kind: 'drop', time: event.time, device: event.device, packet: event.packet }));
  sim.on(Topics.STEP, (event) => { if (event.step.title) push({ kind: 'step', step: event.step }); });
  sim.on(Topics.RESET, () => { lines.length = 0; drawAll(); });
  onLangChange(drawAll);
  drawAll();
}
