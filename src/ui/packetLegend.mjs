// Légende vivante des paquets, dans un coin de la scène 3D.
//
// Chaque paquet est une carte-message (type de message, puis qui parle à qui) dont le liseré a
// la couleur de son protocole. Un étudiant ne connaît pas ces couleurs : la légende n'affiche
// donc que les protocoles du scénario EN COURS (ceux qu'il déclare, puis ceux qui circulent
// vraiment), avec leur couleur.

import { Topics } from '../sim/events.mjs';
import { el } from './dom.mjs';
import { applyI18n, onLangChange, registerStrings } from './i18n.mjs';

registerStrings({
  fr: {
    'pleg.title': 'Protocoles du scénario',
    'pleg.hint': 'Chaque carte donne le type de message et qui parle à qui ; un clic montre ses champs.',
  },
  en: {
    'pleg.title': 'Protocols in this scenario',
    'pleg.hint': 'Each card gives the message type and who talks to whom; click it to see its fields.',
  },
});

export function initPacketLegend(app, slot = document.getElementById('scene')) {
  const { sim, render } = app;
  if (!slot || !render || typeof render.legend !== 'function') return null;
  const seen = new Set();
  const protocols = el('div', { class: 'pleg-protocols' });
  const box = el('aside', { class: 'pkt-legend', 'aria-live': 'polite', 'data-i18n-title': 'pleg.hint' }, protocols);
  slot.append(box);

  function drawProtocols() {
    const items = render.legend().filter((item) => seen.has(item.id));
    protocols.replaceChildren(
      el('span', { class: 'pleg-title', 'data-i18n': 'pleg.title' }),
      ...items.map((item) => el('span', { class: 'pleg-item' }, el('span', { class: 'chip', style: `background:${item.color}` }), item.name)),
    );
    box.hidden = items.length === 0;
    applyI18n(box);
  }

  /** Protocoles déclarés par le scénario (ils s'affichent avant le premier paquet). */
  function reset(scenario) {
    seen.clear();
    for (const id of (scenario && scenario.protocols) || []) seen.add(id);
    drawProtocols();
  }

  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => reset(scenario));
  sim.on(Topics.PACKET_SEND, ({ packet }) => {
    if (packet && packet.protocol && !seen.has(packet.protocol)) {
      seen.add(packet.protocol);
      drawProtocols();
    }
  });
  onLangChange(drawProtocols);
  reset(sim.scenario);
  return { element: box, get protocols() { return [...seen]; } };
}

