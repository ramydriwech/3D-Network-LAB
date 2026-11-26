// DHCP — Dynamic Host Configuration Protocol : un poste obtient automatiquement son
// adresse IP, son masque, sa passerelle et son serveur DNS.
//
// Les quatre messages (« DORA ») circulent en UDP, ports 67 (serveur) et 68 (client) :
//   Discover → Offer → Request → Ack
//
// Simplifications pédagogiques :
//   - les quatre messages sont diffusés (le client n'a pas encore d'adresse pour recevoir
//     une réponse directe ; un vrai serveur peut aussi répondre en unicast) ;
//   - un seul serveur, pas de relais DHCP, pas de renouvellement ni d'expiration du bail.

import { note } from '../events.js';
import { BROADCAST_IP, UNSPECIFIED_IP, ipToInt, intToIp, maskToString } from '../addr.js';

export const DHCP_SERVER_PORT = 67;
export const DHCP_CLIENT_PORT = 68;

const texts = {
  'dhcp.discover': {
    fr: 'Discover — {name} n\'a pas d\'adresse IP. Il diffuse à tout le réseau, depuis l\'adresse 0.0.0.0 : « Y a-t-il un serveur DHCP ? »',
    en: 'Discover — {name} has no IP address. From address 0.0.0.0 it broadcasts to the whole network: "Is there a DHCP server?"',
  },
  'dhcp.offer': {
    fr: 'Offer — {name} choisit une adresse libre dans sa réserve et la propose au client {mac} : {ip}.',
    en: 'Offer — {name} picks a free address from its pool and offers it to client {mac}: {ip}.',
  },
  'dhcp.request': {
    fr: 'Request — {name} accepte l\'offre et le fait savoir à tous : « Je demande {ip} au serveur {server}. » (Diffusé, pour que d\'éventuels autres serveurs retirent leur offre.)',
    en: 'Request — {name} accepts the offer and tells everyone: "I request {ip} from server {server}." (Broadcast, so any other server withdraws its offer.)',
  },
  'dhcp.ack': {
    fr: 'Ack — {name} confirme le bail : {ip} est attribuée à {mac} pour {lease} secondes, avec le masque, la passerelle et le DNS.',
    en: 'Ack — {name} confirms the lease: {ip} is assigned to {mac} for {lease} seconds, along with mask, gateway and DNS.',
  },
  'dhcp.bound': {
    fr: '{name} est configuré : adresse {ip}/{prefix}, passerelle {gateway}, DNS {dns}. Il peut maintenant communiquer en IP.',
    en: '{name} is configured: address {ip}/{prefix}, gateway {gateway}, DNS {dns}. It can now communicate over IP.',
  },
  'dhcp.notMine': {
    fr: '{name} reçoit ce message DHCP diffusé, mais il concerne un autre poste : il l\'ignore.',
    en: '{name} receives this broadcast DHCP message, but it concerns another machine: ignored.',
  },
  'dhcp.poolEmpty': {
    fr: '{name} n\'a plus d\'adresse libre dans sa réserve : il ne répond pas.',
    en: '{name} has no free address left in its pool: it does not answer.',
  },
};

/** Première adresse libre de la plage [start, end], ou l'adresse déjà promise à ce client. */
function allocate(device, service, mac) {
  if (device.dhcpLeases.has(mac)) return device.dhcpLeases.get(mac);
  const taken = new Set(device.dhcpLeases.values());
  for (let value = ipToInt(service.start); value <= ipToInt(service.end); value++) {
    const ip = intToIp(value);
    if (!taken.has(ip)) return ip;
  }
  return null;
}

function broadcast(udp, device, label, dhcp, explain, srcPort, dstPort) {
  return udp.send(device, {
    dst: BROADCAST_IP,
    src: device.primary().ip || UNSPECIFIED_IP,
    srcPort,
    dstPort,
    protocol: 'dhcp',
    label,
    dhcp,
    explain,
  });
}

/** Côté serveur : traite Discover et Request. */
function serve(udp, device, service, packet) {
  const { dhcp } = packet;
  const me = device.primary().ip;
  const offer = (type, ip) => ({
    type, xid: dhcp.xid, clientMac: dhcp.clientMac, yourIp: ip, serverId: me,
    prefix: service.prefix, mask: maskToString(service.prefix),
    gateway: service.gateway || null, dns: service.dns || null, lease: service.lease || 3600,
  });
  if (dhcp.type === 'DISCOVER') {
    const ip = allocate(device, service, dhcp.clientMac);
    if (!ip) return { accepted: true, notes: [note('dhcp.poolEmpty', { name: device.name })] };
    device.dhcpLeases.set(dhcp.clientMac, ip); // adresse réservée le temps de l'échange
    broadcast(udp, device, 'DHCP Offer', offer('OFFER', ip),
      note('dhcp.offer', { name: device.name, mac: dhcp.clientMac, ip }), DHCP_SERVER_PORT, DHCP_CLIENT_PORT);
    return { accepted: true, notes: [] };
  }
  if (dhcp.type === 'REQUEST' && dhcp.serverId === me) {
    const ip = dhcp.requestedIp;
    device.dhcpLeases.set(dhcp.clientMac, ip);
    device.net.update(device, 'dhcp');
    broadcast(udp, device, 'DHCP Ack', offer('ACK', ip),
      note('dhcp.ack', { name: device.name, mac: dhcp.clientMac, ip, lease: service.lease || 3600 }), DHCP_SERVER_PORT, DHCP_CLIENT_PORT);
    return { accepted: true, notes: [] };
  }
  return { accepted: false, notes: [note('dhcp.notMine', { name: device.name })] };
}

/** Côté client : traite Offer et Ack. */
function client(udp, device, packet) {
  const { dhcp } = packet;
  const session = device.dhcpClient;
  if (!session || dhcp.xid !== session.xid || dhcp.clientMac !== device.primary().mac) {
    return { accepted: false, notes: [note('dhcp.notMine', { name: device.name })] };
  }
  if (dhcp.type === 'OFFER' && session.state === 'SELECTING') {
    session.state = 'REQUESTING';
    broadcast(udp, device, 'DHCP Request',
      { type: 'REQUEST', xid: session.xid, clientMac: dhcp.clientMac, requestedIp: dhcp.yourIp, serverId: dhcp.serverId },
      note('dhcp.request', { name: device.name, ip: dhcp.yourIp, server: dhcp.serverId }), DHCP_CLIENT_PORT, DHCP_SERVER_PORT);
    return { accepted: true, notes: [] };
  }
  if (dhcp.type === 'ACK' && session.state === 'REQUESTING') {
    session.state = 'BOUND';
    const iface = device.primary();
    iface.ip = dhcp.yourIp;
    iface.prefix = dhcp.prefix;
    device.gateway = dhcp.gateway;
    device.dnsServer = dhcp.dns;
    device.net.update(device, 'ip');
    return {
      accepted: true,
      notes: [note('dhcp.bound', { name: device.name, ip: iface.ip, prefix: iface.prefix, gateway: dhcp.gateway || '—', dns: dhcp.dns || '—' })],
    };
  }
  return { accepted: false, notes: [note('dhcp.notMine', { name: device.name })] };
}

export default {
  id: 'dhcp',
  name: 'DHCP',
  layer: 'application',
  requires: ['udp'],
  actions: ['dhcp'],
  texts,

  install(device, net) {
    if (!device.sendIp) return;
    const udp = net.registry.get('udp');
    const service = device.def.services && device.def.services.dhcp;
    if (service) {
      device.dhcpLeases = new Map(); // MAC du client -> adresse attribuée
      udp.bind(device, DHCP_SERVER_PORT, (packet) => serve(udp, device, service, packet));
    } else if (!device.forwarding) {
      device.dhcpClient = null;
      udp.bind(device, DHCP_CLIENT_PORT, (packet) => client(udp, device, packet));
    }
  },

  /** Action de scénario : { action: 'dhcp', from }. */
  start(net, step) {
    const device = net.device(step.from);
    if (!device || !device.sendIp) return false;
    const udp = net.registry.get('udp');
    const mac = device.primary().mac;
    // Identifiant de transaction dérivé de la MAC : stable d'une lecture à l'autre.
    const xid = '0x' + mac.replace(/:/g, '').slice(-8).toLowerCase();
    device.dhcpClient = { state: 'SELECTING', xid };
    return broadcast(udp, device, 'DHCP Discover', { type: 'DISCOVER', xid, clientMac: mac },
      note('dhcp.discover', { name: device.name }), DHCP_CLIENT_PORT, DHCP_SERVER_PORT);
  },

  describe(packet) {
    if (!packet.dhcp) return [];
    const { dhcp } = packet;
    const rows = [
      { label: { fr: 'Message', en: 'Message' }, value: 'DHCP ' + dhcp.type },
      { label: { fr: 'Transaction', en: 'Transaction ID' }, value: dhcp.xid },
      { label: { fr: 'MAC du client', en: 'Client MAC' }, value: dhcp.clientMac },
    ];
    if (dhcp.requestedIp) rows.push({ label: { fr: 'Adresse demandée', en: 'Requested address' }, value: dhcp.requestedIp });
    if (dhcp.yourIp) {
      rows.push({ label: { fr: 'Adresse proposée', en: 'Offered address' }, value: dhcp.yourIp });
      rows.push({ label: { fr: 'Masque', en: 'Subnet mask' }, value: dhcp.mask });
      rows.push({ label: { fr: 'Passerelle', en: 'Gateway' }, value: dhcp.gateway || '—' });
      rows.push({ label: { fr: 'Serveur DNS', en: 'DNS server' }, value: dhcp.dns || '—' });
      rows.push({ label: { fr: 'Durée du bail', en: 'Lease time' }, value: `${dhcp.lease} s` });
    }
    if (dhcp.serverId) rows.push({ label: { fr: 'Serveur DHCP', en: 'DHCP server' }, value: dhcp.serverId });
    return rows;
  },

  table(device) {
    if (!device.dhcpLeases) return null;
    return {
      id: 'dhcp',
      title: { fr: 'Baux DHCP', en: 'DHCP leases' },
      columns: [{ fr: 'MAC du client', en: 'Client MAC' }, { fr: 'Adresse', en: 'Address' }],
      rows: [...device.dhcpLeases.entries()],
    };
  },
};
