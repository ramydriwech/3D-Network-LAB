// ARP — Address Resolution Protocol : trouver l'adresse MAC qui correspond à une adresse IP
// du réseau local.
//
// Déroulement simulé :
//   1. l'émetteur consulte son cache ARP ; s'il connaît déjà la MAC, rien ne circule ;
//   2. sinon il diffuse une requête (broadcast) : « Qui a l'adresse IP x ? » ;
//   3. seul le propriétaire de l'adresse répond, directement à l'émetteur (unicast) ;
//   4. chacun mémorise l'autre dans son cache.
//
// Simplifications pédagogiques : les entrées du cache n'expirent pas ; pas d'ARP gratuit ;
// seul l'équipement visé mémorise l'émetteur de la requête.

import { note } from '../events.js';
import { BROADCAST_MAC } from '../addr.js';

/** Sans réponse au bout de ce délai (ms simulées), la résolution échoue. */
export const ARP_TIMEOUT = 12000;

const texts = {
  'arp.request': {
    fr: '{name} veut joindre {ip} mais ne connaît pas son adresse MAC. Il diffuse une requête ARP à tout le réseau local : « Qui a {ip} ? Répondez à {senderIp}. »',
    en: '{name} wants to reach {ip} but does not know its MAC address. It broadcasts an ARP request to the whole local network: "Who has {ip}? Tell {senderIp}."',
  },
  'arp.reply': {
    fr: '{name} reconnaît son adresse {ip} et répond directement au demandeur : « {ip} se trouve à {mac}. »',
    en: '{name} recognises its own address {ip} and replies straight to the asker: "{ip} is at {mac}."',
  },
  'arp.notForMe': {
    fr: '{name} reçoit la requête ARP, mais elle cherche {ip} : ce n\'est pas son adresse, il ne répond pas.',
    en: '{name} receives the ARP request, but it asks for {ip}: not its address, so it stays silent.',
  },
  'arp.learn': {
    fr: '{name} note dans son cache ARP que {ip} correspond à {mac} (il en aura besoin pour répondre).',
    en: '{name} records in its ARP cache that {ip} maps to {mac} (it will need it to answer).',
  },
  'arp.cacheUpdate': {
    fr: '{name} reçoit la réponse et mémorise {ip} → {mac} dans son cache ARP. Le paquet en attente peut partir.',
    en: '{name} receives the reply and stores {ip} → {mac} in its ARP cache. The waiting packet can now leave.',
  },
  'arp.cacheHit': {
    fr: '{name} connaît déjà la MAC de {ip} ({mac}) grâce à son cache ARP : aucune requête ARP n\'est nécessaire.',
    en: '{name} already knows the MAC of {ip} ({mac}) from its ARP cache: no ARP request is needed.',
  },
  'arp.timeout': {
    fr: '{name} : personne n\'a répondu à la requête ARP pour {ip}. L\'adresse est injoignable.',
    en: '{name}: nobody answered the ARP request for {ip}. The address is unreachable.',
  },
};

function learn(device, net, ip, mac) {
  const changed = device.arpCache.get(ip) !== mac;
  device.arpCache.set(ip, mac);
  if (changed) net.update(device, 'arp');
}

function receive(device, net, packet, iface) {
  const { arp } = packet;
  if (arp.op === 'request') {
    // Un routeur ou pare-feu qui fait du NAT statique répond aussi pour l'adresse publique
    // qu'il traduit (« proxy ARP ») : sinon personne ne recevrait les paquets qui lui sont destinés.
    const proxied = iface.ip !== arp.targetIp && device.proxyArp && device.proxyArp(arp.targetIp, iface);
    if (iface.ip !== arp.targetIp && !proxied) {
      return { accepted: false, notes: [note('arp.notForMe', { name: device.name, ip: arp.targetIp })] };
    }
    learn(device, net, arp.senderIp, arp.senderMac);
    const reply = net.packet({
      protocol: 'arp',
      label: 'ARP Reply',
      eth: { src: iface.mac, dst: arp.senderMac, type: 'ARP' },
      arp: { op: 'reply', senderMac: iface.mac, senderIp: arp.targetIp, targetMac: arp.senderMac, targetIp: arp.senderIp },
      explain: note('arp.reply', { name: device.name, ip: arp.targetIp, mac: iface.mac }),
    });
    net.transmit(device, iface.name, reply);
    return { accepted: true, notes: [note('arp.learn', { name: device.name, ip: arp.senderIp, mac: arp.senderMac })] };
  }

  // Réponse : on mémorise puis on libère les paquets qui attendaient cette adresse.
  learn(device, net, arp.senderIp, arp.senderMac);
  const pending = device.arpPending.get(arp.senderIp);
  if (pending) {
    device.arpPending.delete(arp.senderIp);
    net.cancel(pending.timer);
    for (const waiter of pending.waiters) waiter.onResolved(arp.senderMac, []);
  }
  return { accepted: true, notes: [note('arp.cacheUpdate', { name: device.name, ip: arp.senderIp, mac: arp.senderMac })] };
}

export default {
  id: 'arp',
  name: 'ARP',
  layer: 'liaison',
  requires: [],
  actions: [],
  texts,

  install(device, net) {
    if (!device.arpCache) return; // un switch n'a pas d'adresse IP : ARP ne le concerne pas
    device.arpPending = new Map(); // IP -> { waiters, timer }
    device.on('eth:ARP', (packet, iface) => receive(device, net, packet, iface));
  },

  /**
   * Résout `ip` en adresse MAC pour le compte de `device`.
   * `onResolved(mac, notes)` est appelé tout de suite si le cache connaît l'adresse,
   * sinon à l'arrivée de la réponse. `onFailed()` est appelé si personne ne répond.
   */
  resolve(device, iface, ip, onResolved, onFailed = () => {}) {
    const net = device.net;
    const known = device.arpCache.get(ip);
    if (known) {
      onResolved(known, [note('arp.cacheHit', { name: device.name, ip, mac: known })]);
      return;
    }
    const pending = device.arpPending.get(ip);
    if (pending) { // une requête est déjà partie : on attend la même réponse
      pending.waiters.push({ onResolved, onFailed });
      return;
    }
    const timer = net.after(ARP_TIMEOUT, () => {
      const failed = device.arpPending.get(ip);
      device.arpPending.delete(ip);
      net.info(device, [note('arp.timeout', { name: device.name, ip })]);
      for (const waiter of failed ? failed.waiters : []) waiter.onFailed();
    });
    device.arpPending.set(ip, { waiters: [{ onResolved, onFailed }], timer });
    const request = net.packet({
      protocol: 'arp',
      label: 'ARP Request',
      eth: { src: iface.mac, dst: BROADCAST_MAC, type: 'ARP' },
      arp: { op: 'request', senderMac: iface.mac, senderIp: iface.ip, targetMac: '00:00:00:00:00:00', targetIp: ip },
      explain: note('arp.request', { name: device.name, ip, senderIp: iface.ip }),
    });
    net.transmit(device, iface.name, request);
  },

  describe(packet) {
    if (!packet.arp) return [];
    const { arp } = packet;
    return [
      { label: { fr: 'Opération', en: 'Operation' }, value: arp.op === 'request' ? { fr: 'requête (1)', en: 'request (1)' } : { fr: 'réponse (2)', en: 'reply (2)' } },
      { label: { fr: 'MAC émetteur', en: 'Sender MAC' }, value: arp.senderMac },
      { label: { fr: 'IP émetteur', en: 'Sender IP' }, value: arp.senderIp },
      { label: { fr: 'MAC cible', en: 'Target MAC' }, value: arp.op === 'request' ? { fr: '00:00:00:00:00:00 (inconnue)', en: '00:00:00:00:00:00 (unknown)' } : arp.targetMac },
      { label: { fr: 'IP cible', en: 'Target IP' }, value: arp.targetIp },
    ];
  },
};
