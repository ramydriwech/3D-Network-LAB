// IPv6 simplifié (extension F09) : découverte de voisin puis ping.
//
// En IPv6, ARP n'existe plus. Pour trouver l'adresse MAC d'un voisin, on utilise NDP
// (Neighbor Discovery Protocol), qui voyage dans des messages ICMPv6 :
//   1. Neighbor Solicitation (type 135) — envoyée non pas à tout le monde (broadcast)
//      mais à un groupe de multidiffusion calculé d'après l'adresse cherchée ;
//   2. Neighbor Advertisement (type 136) — réponse directe du propriétaire de l'adresse ;
//   3. Echo Request (128) / Echo Reply (129) — le ping, comme en IPv4.
//
// Simplifications pédagogiques : un seul lien (pas de routage IPv6), préfixe /64 supposé,
// pas d'adresse lien-local ni d'autoconfiguration (SLAAC), le cache de voisins n'expire pas.
// L'adresse IPv6 d'une interface s'écrit dans le scénario : { "ipv6": "2001:db8:1::10" }.

import { note } from '../events.js';

export const HOP_LIMIT = 64;

const texts = {
  'ipv6.solicit': {
    fr: '{name} cherche l\'adresse MAC de {target}. Pas de diffusion générale en IPv6 : la Neighbor Solicitation part vers le groupe {group}, auquel seules les machines dont l\'adresse se termine pareil sont abonnées.',
    en: '{name} is looking for the MAC address of {target}. There is no broadcast in IPv6: the Neighbor Solicitation goes to the group {group}, joined only by machines whose address ends the same way.',
  },
  'ipv6.notForMe': {
    fr: '{name} n\'est pas abonné au groupe visé (son adresse est {own}) : sa carte réseau écarte la trame.',
    en: '{name} has not joined the target group (its address is {own}): its network card discards the frame.',
  },
  'ipv6.advertise': {
    fr: '{name} reconnaît son adresse {target} et répond directement par une Neighbor Advertisement : « {target} se trouve à {mac}. »',
    en: '{name} recognises its address {target} and answers directly with a Neighbor Advertisement: "{target} is at {mac}."',
  },
  'ipv6.learn': {
    fr: '{name} mémorise {ip} → {mac} dans son cache de voisins (l\'équivalent du cache ARP).',
    en: '{name} stores {ip} → {mac} in its neighbour cache (the counterpart of the ARP cache).',
  },
  'ipv6.cacheHit': {
    fr: '{name} connaît déjà la MAC de {ip} ({mac}) grâce à son cache de voisins : aucune sollicitation n\'est nécessaire.',
    en: '{name} already knows the MAC of {ip} ({mac}) from its neighbour cache: no solicitation is needed.',
  },
  'ipv6.echoRequest': {
    fr: '{name} envoie un ICMPv6 Echo Request à {dst} — « es-tu là ? ».',
    en: '{name} sends an ICMPv6 Echo Request to {dst} — "are you there?".',
  },
  'ipv6.echoReply': {
    fr: '{name} répond par un ICMPv6 Echo Reply à {dst}.',
    en: '{name} answers {dst} with an ICMPv6 Echo Reply.',
  },
  'ipv6.success': {
    fr: 'Ping IPv6 réussi : {name} reçoit la réponse de {src} (hop limit {hops}).',
    en: 'IPv6 ping succeeded: {name} receives the reply from {src} (hop limit {hops}).',
  },
  'ipv6.noAddress': {
    fr: '{name} n\'a pas d\'adresse IPv6 : le ping IPv6 est impossible.',
    en: '{name} has no IPv6 address: the IPv6 ping cannot be sent.',
  },
};

/** Les 8 groupes de 16 bits d'une adresse IPv6, « :: » développé. */
export function expand(address) {
  const [head, tail] = String(address).toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : new Array(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group || '0', 16));
}

/** Les 24 derniers bits de l'adresse, en trois octets hexadécimaux. */
function lastBytes(address) {
  const groups = expand(address);
  return [groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].map((byte) => byte.toString(16).padStart(2, '0'));
}

/** Groupe de multidiffusion « nœud sollicité » de l'adresse : ff02::1:ffXX:XXXX. */
export function solicitedNode(address) {
  const [a, b, c] = lastBytes(address);
  return `ff02::1:ff${a}:${b}${c}`;
}

/** Adresse MAC de multidiffusion correspondante : 33:33:FF:XX:XX:XX. */
export function solicitedMac(address) {
  return ['33', '33', 'ff', ...lastBytes(address)].join(':').toUpperCase();
}

/** Adresse IPv6 d'un équipement (première interface qui en déclare une), ou null. */
export function addressOf(device) {
  for (const iface of (device && device.def.interfaces) || []) {
    if (iface.ipv6) return { ip: iface.ipv6.toLowerCase(), iface: device.iface(iface.name) };
  }
  return null;
}

function frame(device, own, dstMac, dstIp, label, icmp6, explain) {
  return device.net.packet({
    protocol: 'ipv6',
    label,
    eth: { src: own.iface.mac, dst: dstMac, type: 'IPv6' },
    ipv6: { src: own.ip, dst: dstIp, hopLimit: HOP_LIMIT, next: 'ICMPv6' },
    icmp6,
    explain,
  });
}

function sendEcho(device, own, dstIp, mac, notes = []) {
  const packet = frame(device, own, mac, dstIp, 'ICMPv6 Echo Request',
    { type: 128, name: 'Echo Request', id: 1, seq: 1 },
    note('ipv6.echoRequest', { name: device.name, dst: dstIp }));
  device.net.transmit(device, own.iface.name, packet, notes);
}

function receive(device, net, packet) {
  const own = addressOf(device);
  const { icmp6, ipv6 } = packet;
  if (!own || !icmp6) return { accepted: false, notes: [] };

  if (icmp6.type === 135) { // Neighbor Solicitation
    if (icmp6.target !== own.ip) {
      return { accepted: false, notes: [note('ipv6.notForMe', { name: device.name, own: own.ip })] };
    }
    device.neighbours.set(ipv6.src, packet.eth.src);
    net.update(device, 'ndp');
    net.transmit(device, own.iface.name, frame(device, own, packet.eth.src, ipv6.src, 'Neighbor Advertisement',
      { type: 136, name: 'Neighbor Advertisement', target: own.ip, mac: own.iface.mac },
      note('ipv6.advertise', { name: device.name, target: own.ip, mac: own.iface.mac })));
    return { accepted: true, notes: [note('ipv6.learn', { name: device.name, ip: ipv6.src, mac: packet.eth.src })] };
  }
  if (ipv6.dst !== own.ip) return { accepted: false, notes: [note('ipv6.notForMe', { name: device.name, own: own.ip })] };

  if (icmp6.type === 136) { // Neighbor Advertisement
    device.neighbours.set(icmp6.target, icmp6.mac);
    net.update(device, 'ndp');
    const waiting = device.ndPending.get(icmp6.target);
    device.ndPending.delete(icmp6.target);
    if (waiting) waiting(icmp6.mac);
    return { accepted: true, notes: [note('ipv6.learn', { name: device.name, ip: icmp6.target, mac: icmp6.mac })] };
  }
  if (icmp6.type === 128) { // Echo Request
    const mac = device.neighbours.get(ipv6.src) || packet.eth.src;
    net.transmit(device, own.iface.name, frame(device, own, mac, ipv6.src, 'ICMPv6 Echo Reply',
      { type: 129, name: 'Echo Reply', id: icmp6.id, seq: icmp6.seq },
      note('ipv6.echoReply', { name: device.name, dst: ipv6.src })));
    return { accepted: true, notes: [] };
  }
  if (icmp6.type === 129) { // Echo Reply
    return { accepted: true, notes: [note('ipv6.success', { name: device.name, src: ipv6.src, hops: ipv6.hopLimit })] };
  }
  return { accepted: false, notes: [] };
}

export default {
  id: 'ipv6',
  name: 'IPv6 / ICMPv6',
  layer: 'réseau',
  requires: [],
  actions: ['ping6'],
  texts,

  install(device, net) {
    if (!device.on) return; // un switch ne lit pas l'en-tête IPv6
    device.neighbours = new Map(); // IPv6 -> MAC
    device.ndPending = new Map();  // IPv6 cherchée -> suite à donner
    device.on('eth:IPv6', (packet) => receive(device, net, packet));
  },

  /** Action de scénario : { action: 'ping6', from, to } (identifiants d'équipements du même lien). */
  start(net, step) {
    const device = net.device(step.from);
    const own = addressOf(device);
    const target = addressOf(net.device(step.to));
    if (!device || !own || !target) {
      net.info(device, [note('ipv6.noAddress', { name: device ? device.name : step.from })]);
      return false;
    }
    const known = device.neighbours.get(target.ip);
    if (known) {
      sendEcho(device, own, target.ip, known, [note('ipv6.cacheHit', { name: device.name, ip: target.ip, mac: known })]);
      return true;
    }
    device.ndPending.set(target.ip, (mac) => sendEcho(device, own, target.ip, mac));
    const group = solicitedNode(target.ip);
    net.transmit(device, own.iface.name, frame(device, own, solicitedMac(target.ip), group, 'Neighbor Solicitation',
      { type: 135, name: 'Neighbor Solicitation', target: target.ip },
      note('ipv6.solicit', { name: device.name, target: target.ip, group })));
    return true;
  },

  describe(packet) {
    if (!packet.ipv6) return [];
    const rows = [
      { label: { fr: 'Source (IPv6)', en: 'Source (IPv6)' }, value: packet.ipv6.src },
      { label: { fr: 'Destination (IPv6)', en: 'Destination (IPv6)' }, value: packet.ipv6.dst },
      { label: { fr: 'Hop limit (équivalent du TTL)', en: 'Hop limit (TTL equivalent)' }, value: packet.ipv6.hopLimit },
      { label: { fr: 'En-tête suivant', en: 'Next header' }, value: packet.ipv6.next },
    ];
    if (packet.icmp6) {
      rows.push({ label: { fr: 'ICMPv6 — type', en: 'ICMPv6 — type' }, value: `${packet.icmp6.type} — ${packet.icmp6.name}` });
      if (packet.icmp6.target) rows.push({ label: { fr: 'Adresse cherchée', en: 'Target address' }, value: packet.icmp6.target });
      if (packet.icmp6.mac) rows.push({ label: { fr: 'Adresse MAC annoncée', en: 'Advertised MAC' }, value: packet.icmp6.mac });
      if (packet.icmp6.seq !== undefined) rows.push({ label: { fr: 'N° de séquence', en: 'Sequence number' }, value: packet.icmp6.seq });
    }
    return rows;
  },

  table(device) {
    if (!device.neighbours) return null;
    return {
      id: 'ndp',
      title: { fr: 'Cache de voisins (IPv6)', en: 'Neighbour cache (IPv6)' },
      columns: [{ fr: 'Adresse IPv6', en: 'IPv6 address' }, { fr: 'Adresse MAC', en: 'MAC address' }],
      rows: [...device.neighbours.entries()],
    };
  },
};
