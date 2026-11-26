// Inspecteur de paquet : un clic sur un paquet (dans la scène, dans le labo, ou sur une ligne du
// journal) affiche son contenu comme un analyseur de trames, couche par couche :
//   Ethernet II → ARP, IPv4 ou IPv6 → ICMP, ICMPv6, UDP ou TCP → message applicatif.
// Les en-têtes (longueurs, identification, indicateurs, sommes de contrôle, FCS) sont
// reconstruits octet par octet par src/sim/wire.mjs ; le message applicatif (DHCP, DNS, HTTP)
// vient de la fonction describe() de son protocole. En bas : les octets de la trame.

import { Topics } from '../sim/events.mjs';
import { packetLayers, hexDump } from '../sim/wire.mjs';
import { el, panelTitle } from './dom.mjs';
import { applyI18n, localize, onLangChange, registerStrings, t } from './i18n.mjs';

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
    'insp.app': 'Message {name} (couche application)',
    'insp.bytes': 'Octets de la trame ({n}) en hexadécimal',
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
    'insp.app': '{name} message (application layer)',
    'insp.bytes': 'Frame bytes ({n}) in hexadecimal',
  },
});

function section(title, rows) {
  return el('section', { class: 'layer' },
    el('h3', { class: 'sub-title' }, title),
    el('dl', { class: 'fields' }, rows.flatMap((row) => [
      el('dt', {}, localize(row.label)),
      el('dd', {}, String(localize(row.value) ?? ''), row.note ? el('small', { class: 'field-note' }, localize(row.note)) : null),
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

    // En-têtes reconstruits octet par octet (wire.mjs), puis le message applicatif.
    const wire = packetLayers(packet);
    for (const layer of wire.layers) children.push(section(localize(layer.title), layer.fields));
    for (const protocol of sim.registry.all()) {
      if (protocol.layer !== 'application') continue;
      const rows = protocol.describe(packet);
      if (rows.length) children.push(section(t('insp.app', { name: protocol.name }), rows));
    }
    // Données d'un datagramme UDP sans protocole applicatif connu (ICMP montre déjà les siennes).
    if (packet.data && packet.udp && !packet.dns && !packet.dhcp) children.push(section(t('insp.data'), [{ label: '', value: packet.data }]));
    children.push(el('details', { class: 'hex-dump' },
      el('summary', {}, t('insp.bytes', { n: wire.frameLength })),
      el('pre', {}, hexDump(wire.bytes))));

    slot.replaceChildren(...children);
    applyI18n(slot);
  }

  sim.on(Topics.SELECT, (event) => {
    if (event.kind !== 'packet') return;
    packet = event.packet;
    // L'inspecteur est dans l'onglet Lecture : on y revient s'il était caché (Construire, Missions…).
    if (app.tabs && app.tabs.current && app.tabs.current !== 'play' && app.tabs.select) app.tabs.select('play');
    draw();
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  sim.on(Topics.RESET, () => { packet = null; draw(); });
  onLangChange(draw);
  draw();
}
