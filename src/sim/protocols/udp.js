// UDP — User Datagram Protocol : transport « sans connexion ».
// L'émetteur envoie son datagramme sans rien établir avant et sans attendre d'accusé de
// réception. Le numéro de port désigne l'application destinataire.
//
// Simplifications pédagogiques : pas de somme de contrôle ; un port sans application
// provoque un message ICMP « Port Unreachable », comme sur une vraie machine.

import { note } from '../events.js';
import { BROADCAST_IP } from '../addr.js';
import { targetIp } from './icmp.js';

const FIRST_EPHEMERAL_PORT = 49152;

const texts = {
  'udp.send': {
    fr: '{name} envoie un datagramme UDP à {dst}, port {port}. Aucune connexion n\'est ouverte et aucun accusé de réception n\'est attendu.',
    en: '{name} sends a UDP datagram to {dst}, port {port}. No connection is opened and no acknowledgement is expected.',
  },
  'udp.delivered': {
    fr: '{name} : le datagramme est remis à l\'application qui écoute sur le port {port}. UDP ne renvoie rien : l\'émetteur ne saura pas s\'il est arrivé.',
    en: '{name}: the datagram is handed to the application listening on port {port}. UDP sends nothing back: the sender will not know whether it arrived.',
  },
  'udp.portClosed': {
    fr: '{name} : aucune application n\'écoute sur le port UDP {port}. Le datagramme est détruit.',
    en: '{name}: no application listens on UDP port {port}. The datagram is discarded.',
  },
  'udp.ignored': {
    fr: '{name} reçoit cette diffusion UDP (port {port}) mais n\'a aucune application concernée : il l\'ignore.',
    en: '{name} receives this UDP broadcast (port {port}) but has no application for it: ignored.',
  },
};

function receive(device, net, packet) {
  const port = packet.udp.dstPort;
  const handler = device.udpPorts.get(port);
  if (handler) {
    return handler(packet) || { accepted: true, notes: [note('udp.delivered', { name: device.name, port })] };
  }
  if (packet.ip.dst === BROADCAST_IP) {
    return { accepted: false, notes: [note('udp.ignored', { name: device.name, port })] };
  }
  net.drop(device, packet, [note('udp.portClosed', { name: device.name, port })]);
  const icmp = net.registry.get('icmp');
  if (icmp) icmp.error(device, packet, 'port');
  return { accepted: true, notes: [note('udp.portClosed', { name: device.name, port })] };
}

const udp = {
  id: 'udp',
  name: 'UDP',
  layer: 'transport',
  requires: ['arp', 'icmp'],
  actions: ['udp'],
  texts,

  install(device, net) {
    if (!device.sendIp) return;
    device.udpPorts = new Map(); // port -> fonction de réception
    device.udpNextPort = FIRST_EPHEMERAL_PORT;
    device.on('ip:UDP', (packet) => receive(device, net, packet));
    const service = device.def.services && device.def.services.udp;
    for (const port of (service && service.listen) || []) udp.bind(device, port, () => undefined);
  },

  /** Associe une application à un port. `handler(packet)` peut retourner { accepted, notes }. */
  bind(device, port, handler) { device.udpPorts.set(port, handler); },
  unbind(device, port) { device.udpPorts.delete(port); },

  /** Port source temporaire, attribué dans l'ordre pour rester déterministe. */
  ephemeralPort(device) { return device.udpNextPort++; },

  /**
   * Envoie un datagramme. `fields` : { dst, srcPort?, dstPort, data?, src? } et, pour un
   * protocole applicatif, ses propres champs { protocol, label, explain, dns… }.
   */
  send(device, fields) {
    const { srcPort, dstPort, data = '', ...rest } = fields;
    const from = srcPort || udp.ephemeralPort(device);
    return device.sendIp({
      proto: 'UDP',
      protocol: 'udp',
      label: `UDP ${from} → ${dstPort}`,
      explain: note('udp.send', { name: device.name, dst: fields.dst, port: dstPort }),
      ...rest,
      udp: { srcPort: from, dstPort, length: 8 + String(data).length },
      data,
    });
  },

  /** Action de scénario : { action: 'udp', from, to, port, data? }. */
  start(net, step) {
    const device = net.device(step.from);
    const dst = targetIp(net, step.to);
    if (!device || !device.sendIp || !dst) return false;
    return udp.send(device, { dst, dstPort: step.port, data: step.data || 'Bonjour' });
  },

  describe(packet) {
    if (!packet.udp) return [];
    return [
      { label: { fr: 'Port source', en: 'Source port' }, value: packet.udp.srcPort },
      { label: { fr: 'Port destination', en: 'Destination port' }, value: packet.udp.dstPort },
      { label: { fr: 'Longueur', en: 'Length' }, value: { fr: `${packet.udp.length} octets`, en: `${packet.udp.length} bytes` } },
    ];
  },
};

export default udp;
