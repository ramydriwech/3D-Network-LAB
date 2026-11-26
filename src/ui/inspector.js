// Inspecteur de paquet : un clic sur un paquet (ou sur une ligne du journal) affiche ses
// champs, couche par couche : Ethernet, puis ARP ou IP, puis transport et application.
// Les lignes propres à chaque protocole viennent de sa fonction describe().

import { Topics, PROTOCOL_CONTRACT } from '../sim/events.js';
import { el, panelTitle } from './dom.js';
import { applyI18n, localize, onLangChange, registerStrings, t } from './i18n.js';

registerStrings({
  fr: {
    'insp.title': 'Inspecteur de paquet',
    'insp.hint': 'Mettez en pause ou avancez pas à pas, puis cliquez sur un paquet dans la scène ou sur une ligne du journal.',
    'insp.eth': 'Ethernet (couche liaison)', 'insp.ip': 'IP (couche réseau)', 'insp.data': 'Contenu (simplifié)',
    'insp.src': 'Source', 'insp.dst': 'Destination', 'insp.type': 'Type',
    'insp.ttl': 'TTL (durée de vie)', 'insp.proto': 'Protocole transporté',
    'insp.cast.unicast': 'Unicast — un seul destinataire',
    'insp.cast.broadcast': 'Diffusion — tout le réseau local',
    'insp.cast.multicast': 'Multidiffusion — un groupe',
    'insp.broadcast': '(diffusion)',
  },
  en: {
    'insp.title': 'Packet inspector',
    'insp.hint': 'Pause or step through the simulation, then click a packet in the scene or a line of the log.',
    'insp.eth': 'Ethernet (link layer)', 'insp.ip': 'IP (network layer)', 'insp.data': 'Content (simplified)',
    'insp.src': 'Source', 'insp.dst': 'Destination', 'insp.type': 'Type',
    'insp.ttl': 'TTL (time to live)', 'insp.proto': 'Carried protocol',
    'insp.cast.unicast': 'Unicast — a single recipient',
    'insp.cast.broadcast': 'Broadcast — the whole local network',
    'insp.cast.multicast': 'Multicast — a group',
    'insp.broadcast': '(broadcast)',
  },
});

function section(title, rows) {
  return el('section', { class: 'layer' },
    el('h3', { class: 'sub-title' }, title),
    el('dl', { class: 'fields' }, rows.flatMap((row) => [
      el('dt', {}, localize(row.label)),
      el('dd', {}, localize(row.value)),
    ])));
}

export function initInspector(app, slot = document.getElementById('inspector')) {
  const { sim, render } = app;
  let packet = null;

  function draw() {
    if (!packet) {
      slot.replaceChildren(panelTitle('insp.title'), el('p', { class: 'muted', 'data-i18n': 'insp.hint' }));
      applyI18n(slot);
      return;
    }
    const color = render.packetColor(packet);
    const children = [
      panelTitle('insp.title'),
      el('p', { class: 'packet-head' },
        el('span', { class: 'chip', style: `background:${color}` }),
        el('strong', {}, packet.label),
        el('span', { class: 'muted small' }, ' — ' + t('insp.cast.' + (packet.cast || 'unicast')))),
    ];

    children.push(section(t('insp.eth'), [
      { label: t('insp.src') + ' (MAC)', value: packet.eth.src },
      { label: t('insp.dst') + ' (MAC)', value: packet.eth.dst + (packet.cast === 'broadcast' ? ' ' + t('insp.broadcast') : '') },
      { label: t('insp.type'), value: packet.eth.type },
    ]));

    // Les protocoles sont parcourus dans l'ordre des couches ; IP s'insère avant la couche réseau.
    const protocols = [...sim.registry.all()].sort((a, b) =>
      PROTOCOL_CONTRACT.layers.indexOf(a.layer) - PROTOCOL_CONTRACT.layers.indexOf(b.layer));
    let ipShown = false;
    const showIp = () => {
      if (ipShown || !packet.ip) return;
      ipShown = true;
      children.push(section(t('insp.ip'), [
        { label: t('insp.src') + ' (IP)', value: packet.ip.src },
        { label: t('insp.dst') + ' (IP)', value: packet.ip.dst },
        { label: t('insp.ttl'), value: packet.ip.ttl },
        { label: t('insp.proto'), value: packet.ip.proto },
      ]));
    };
    for (const protocol of protocols) {
      if (protocol.layer !== 'liaison') showIp();
      const rows = protocol.describe(packet);
      if (rows.length) children.push(section(protocol.name, rows));
    }
    showIp();
    if (packet.data) children.push(section(t('insp.data'), [{ label: '', value: packet.data }]));

    slot.replaceChildren(...children);
    applyI18n(slot);
  }

  sim.on(Topics.SELECT, (event) => {
    if (event.kind !== 'packet') return;
    packet = event.packet;
    draw();
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  sim.on(Topics.RESET, () => { packet = null; draw(); });
  onLangChange(draw);
  draw();
}
