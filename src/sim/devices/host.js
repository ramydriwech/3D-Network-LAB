// Comportement d'un hôte IP (PC ou serveur).
//
// Simplifications pédagogiques :
//  - une table de routage réduite au réseau local et à la passerelle par défaut ;
//  - pas de fragmentation, pas de somme de contrôle ;
//  - les protocoles se branchent avec device.on('ip:ICMP', fn), device.on('eth:ARP', fn)…

import { Device } from '../network.js';
import { note } from '../events.js';
import {
  BROADCAST_MAC, BROADCAST_IP, UNSPECIFIED_IP,
  broadcastOf, inNetwork, isGroupMac, maskToString, networkOf,
} from '../addr.js';

export const texts = {
  'host.noVlan': {
    fr: '{name} reçoit une trame du VLAN {vlan} sur {iface}, mais n\'a aucune sous-interface pour ce VLAN : elle est ignorée.',
    en: '{name} receives a VLAN {vlan} frame on {iface}, but has no sub-interface for that VLAN: it is ignored.',
  },
  'host.notForMe': {
    fr: '{name} : la trame est adressée à {dst}, ce n\'est pas mon adresse MAC. Je l\'ignore.',
    en: '{name}: the frame is addressed to {dst}, which is not my MAC address. I ignore it.',
  },
  'host.notMyIp': {
    fr: '{name} : le paquet IP est destiné à {dst}, ce n\'est pas mon adresse. Je l\'ignore.',
    en: '{name}: the IP packet is for {dst}, which is not my address. I ignore it.',
  },
  'host.noHandler': {
    fr: '{name} ne sait pas traiter ce type de message ({what}).',
    en: '{name} cannot handle this kind of message ({what}).',
  },
  'host.direct': {
    fr: '{dst} est dans le même réseau que {name} ({network}/{prefix}) : remise directe, sans passer par un routeur.',
    en: '{dst} is in the same network as {name} ({network}/{prefix}): direct delivery, no router involved.',
  },
  'host.viaGateway': {
    fr: '{dst} n\'est pas dans le réseau de {name} : le paquet est confié à la passerelle {gateway}.',
    en: '{dst} is outside {name}\'s network: the packet is handed to the gateway {gateway}.',
  },
  'host.noRoute': {
    fr: '{name} n\'a aucune route vers {dst} (pas de passerelle configurée) : envoi impossible.',
    en: '{name} has no route to {dst} (no gateway configured): cannot send.',
  },
  'host.unreachable': {
    fr: '{name} : {ip} ne répond pas à ARP, le paquet en attente est abandonné.',
    en: '{name}: {ip} does not answer ARP, the waiting packet is dropped.',
  },
};

/** Nœud IP : base commune de l'hôte et du routeur. */
export class IpNode extends Device {
  constructor(def, net) {
    super(def, net);
    this.gateway = def.gateway || null;
    this.dnsServer = def.dns || null;
    this.arpCache = new Map(); // IP -> MAC
    this.handlers = new Map(); // 'eth:ARP', 'ip:ICMP', 'ip:UDP'… -> fonction
    this.forwarding = false;   // vrai pour un routeur
  }

  /** Branche la réception d'un type de message (appelé par install() des protocoles). */
  on(key, handler) {
    this.handlers.set(key, handler);
  }

  ownsIp(ip) {
    return this.interfaces.some((iface) => iface.ip === ip);
  }

  /** Interface principale : la première qui possède une adresse IP. */
  primary() {
    return this.interfaces.find((iface) => iface.ip) || this.interfaces[0];
  }

  /** Table de routage : réseaux directement connectés, puis route par défaut. */
  routes() {
    const routes = [];
    for (const iface of this.interfaces) {
      if (iface.ip) {
        routes.push({ network: networkOf(iface.ip, iface.prefix), prefix: iface.prefix, via: null, iface: iface.name, kind: 'connected' });
      }
    }
    if (this.gateway) routes.push({ network: UNSPECIFIED_IP, prefix: 0, via: this.gateway, iface: null, kind: 'default' });
    return routes;
  }

  /**
   * Choisit la route vers `dst` : celle dont le préfixe est le plus long (la plus précise).
   * @returns {{iface: Object, nextHop: string, route: Object}|null}
   */
  lookup(dst) {
    const routes = this.routes()
      .filter((route) => inNetwork(dst, route.network, route.prefix))
      .sort((a, b) => b.prefix - a.prefix);
    for (const route of routes) {
      if (!route.via) return { iface: this.iface(route.iface), nextHop: dst, route };
      // Le prochain saut doit lui-même être joignable sur un réseau connecté.
      const out = this.interfaces.find((iface) => iface.ip && inNetwork(route.via, iface.ip, iface.prefix));
      if (out) return { iface: out, nextHop: route.via, route };
    }
    return null;
  }

  /**
   * Émet un paquet IP. `fields` contient { dst, proto, ttl?, src?, protocol, label, explain }
   * et les couches supérieures (icmp, udp, tcp, dns…).
   * @returns {boolean} false si aucune route n'existe
   */
  sendIp(fields, notes = []) {
    const { dst, proto, ttl = 64, src, ...upper } = fields;

    // Diffusion limitée (255.255.255.255) : jamais routée, envoyée telle quelle sur le lien.
    if (dst === BROADCAST_IP) {
      const iface = this.primary();
      const packet = this.net.packet({
        ...upper,
        eth: { src: iface.mac, dst: BROADCAST_MAC, type: 'IPv4' },
        ip: { src: src || iface.ip || UNSPECIFIED_IP, dst, ttl, proto },
      });
      return this.net.transmit(this, iface.name, packet, notes);
    }

    const hop = this.lookup(dst);
    if (!hop) {
      this.net.info(this, [note('host.noRoute', { name: this.name, dst })]);
      return false;
    }
    const why = hop.route.via
      ? note('host.viaGateway', { name: this.name, dst, gateway: hop.route.via })
      : note('host.direct', { name: this.name, dst, network: hop.route.network, prefix: hop.route.prefix });
    const ip = { src: src || hop.iface.ip, dst, ttl, proto };
    this.output(hop, (mac) => this.net.packet({
      ...upper,
      eth: { src: hop.iface.mac, dst: mac, type: 'IPv4' },
      ip,
    }), [why, ...notes]);
    return true;
  }

  /**
   * Trouve l'adresse MAC du prochain saut (cache ARP ou requête ARP) puis émet.
   * `makePacket(mac)` construit la trame une fois l'adresse MAC connue ; `notes` est une
   * liste d'explications ou une fonction (mac) => liste.
   */
  output(hop, makePacket, notes = []) {
    const send = (mac, arpNotes = []) => {
      const own = typeof notes === 'function' ? notes(mac) : notes;
      this.net.transmit(this, hop.iface.name, makePacket(mac), [...own, ...arpNotes]);
    };
    if (hop.nextHop === broadcastOf(hop.iface.ip, hop.iface.prefix)) {
      send(BROADCAST_MAC);
      return;
    }
    const arp = this.net.registry.get('arp');
    if (!arp) throw new Error('Le protocole ARP doit figurer dans « protocols » du scénario.');
    arp.resolve(this, hop.iface, hop.nextHop, send, () => {
      this.net.info(this, [note('host.unreachable', { name: this.name, ip: hop.nextHop })]);
    });
  }

  /** Réception d'une trame : filtrage Ethernet, puis remise au bon protocole. */
  receive(packet, ifaceName) {
    // Trame étiquetée (802.1Q) : elle appartient à la sous-interface de son VLAN.
    let iface = this.iface(ifaceName);
    if (packet.vlan) {
      const sub = this.interfaces.find((item) => item.parent === ifaceName && item.vlan === packet.vlan);
      if (!sub) return { accepted: false, notes: [note('host.noVlan', { name: this.name, vlan: packet.vlan, iface: ifaceName })] };
      iface = sub;
    }
    const forMe = packet.eth.dst === iface.mac;
    if (!forMe && !isGroupMac(packet.eth.dst)) {
      return { accepted: false, notes: [note('host.notForMe', { name: this.name, dst: packet.eth.dst })] };
    }
    if (packet.eth.type === 'ARP') return this.dispatch('eth:ARP', packet, iface);
    if (packet.eth.type === 'IPv6') return this.dispatch('eth:IPv6', packet, iface);
    // Contrôles d'entrée d'un routeur ou d'un pare-feu : liste d'accès, NAT retour, pare-feu.
    if (packet.ip && this.filterIn) {
      const verdict = this.filterIn(packet, iface);
      if (verdict.result) return verdict.result;
      packet = verdict.packet;
    }
    if (packet.ip) {
      const dst = packet.ip.dst;
      const local = this.ownsIp(dst) || dst === BROADCAST_IP
        || (iface.ip && dst === broadcastOf(iface.ip, iface.prefix));
      if (local) return this.dispatch('ip:' + packet.ip.proto, packet, iface);
      if (this.forwarding && forMe) return this.forward(packet, iface);
      return { accepted: false, notes: [note('host.notMyIp', { name: this.name, dst })] };
    }
    return { accepted: false, notes: [] };
  }

  dispatch(key, packet, iface) {
    const handler = this.handlers.get(key);
    if (!handler) {
      return { accepted: false, notes: [note('host.noHandler', { name: this.name, what: key.split(':')[1] })] };
    }
    return handler(packet, iface) || { accepted: true, notes: [] };
  }

  tables() {
    return [{
      id: 'arp',
      title: { fr: 'Cache ARP', en: 'ARP cache' },
      columns: [{ fr: 'Adresse IP', en: 'IP address' }, { fr: 'Adresse MAC', en: 'MAC address' }],
      rows: [...this.arpCache.entries()],
    }];
  }

  /** Lignes de la table de routage pour l'affichage. */
  routeRows() {
    return this.routes().map((route) => {
      const out = route.iface
        || (this.interfaces.find((iface) => iface.ip && inNetwork(route.via, iface.ip, iface.prefix)) || {}).name;
      return [
        `${route.network}/${route.prefix}`,
        route.via || { fr: 'directement connecté', en: 'directly connected' },
        out || '—',
      ];
    });
  }
}

/** PC ou serveur : un nœud IP qui ne relaie pas les paquets des autres. */
export class Host extends IpNode {
  describeAddress() {
    const iface = this.primary();
    return iface && iface.ip ? `${iface.ip}/${iface.prefix} (${maskToString(iface.prefix)})` : '—';
  }
}

/** Fabrique appelée par le réseau pour chaque équipement de type host ou server. */
export function create(def, net) {
  return new Host(def, net);
}
