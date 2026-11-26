// Apparence des paquets. Un paquet est une CARTE-MESSAGE posée au-dessus d'un point lumineux
// qui glisse sur le câble (packetAnimator.js) :
//   - 1re ligne : le type de message (« ICMP Echo Reply », « ARP Request ») ;
//   - 2e ligne : qui parle à qui (« PC3 → PC1 », « PC1 → tous ») — packetCaption ci-dessous ;
//   - le liseré de la carte et le point ont la COULEUR du protocole, un simple repère en plus :
//     la légende vivante de l'interface n'affiche que les protocoles du scénario en cours.
//
// Ce fichier ne contient que des données et des calculs (pas de Three.js) : l'interface s'en
// sert aussi, et il se teste sans navigateur.

/** Couleur de chacune des neuf familles de paquets (contraste vérifié sur fond sombre). */
export const PROTOCOL_COLORS = Object.freeze({
  arp: '#f59e0b',  // ambre
  icmp: '#22c55e', // vert
  ip: '#94a3b8',   // gris (paquet IP générique, paquet de test)
  udp: '#06b6d4',  // cyan
  tcp: '#3b82f6',  // bleu
  dns: '#a855f7',  // violet
  dhcp: '#ec4899', // rose
  http: '#ef4444', // rouge
  ipv6: '#14b8a6', // turquoise
});

export const PROTOCOL_NAMES = Object.freeze({
  arp: 'ARP', icmp: 'ICMP', ip: 'IP', udp: 'UDP', tcp: 'TCP', dns: 'DNS', dhcp: 'DHCP', http: 'HTTP', ipv6: 'IPv6',
});

const FALLBACK_COLOR = '#e2e8f0';

export function packetColor(packet) {
  return PROTOCOL_COLORS[packet && packet.protocol] || FALLBACK_COLOR;
}

/** Type de diffusion d'un paquet : 'unicast' (par défaut), 'broadcast' ou 'multicast'. */
const CASTS = new Set(['unicast', 'broadcast', 'multicast']);

/** Style d'un paquet : { color, cast } — couleur du protocole et type de diffusion. */
export function packetStyle(packet) {
  return { color: packetColor(packet), cast: CASTS.has(packet && packet.cast) ? packet.cast : 'unicast' };
}

const ZERO_MAC = /^0{2}(:0{2}){5}$/;
const isUnspecifiedIp = (ip) => !ip || ip === '0.0.0.0' || ip === '::';

/**
 * Qui parle à qui : { from, to } où chacun est { name } (nom d'équipement), { everyone: true }
 * (diffusion) ou { group: true } (multidiffusion). Les adresses IP (bout à bout) sont préférées
 * aux adresses MAC (le saut en cours) : « PC1 → PC3 » sur chaque câble traversé.
 * @param {Object} packet
 * @param {{ nameOfIp: (ip: string) => string|null, nameOfMac: (mac: string) => string|null }} lookup
 */
export function packetParties(packet, { nameOfIp = () => null, nameOfMac = () => null } = {}) {
  const p = packet || {};
  const ip = p.ip || p.ipv6 || null;
  const eth = p.eth || {};
  const endpoint = (ipAddress, mac, side) => {
    if (side === 'to') {
      if (p.cast === 'broadcast' || ipAddress === '255.255.255.255') return { everyone: true };
      if (p.cast === 'multicast' || (ipAddress && /^ff/i.test(ipAddress))) return { group: true };
    }
    const byIp = !isUnspecifiedIp(ipAddress) && nameOfIp(ipAddress);
    if (byIp) return { name: byIp };
    const byMac = mac && !ZERO_MAC.test(mac) && nameOfMac(mac);
    if (byMac) return { name: byMac };
    return { name: '?' };
  };
  // ARP : l'émetteur et la cible sont dans le message lui-même.
  if (p.arp) {
    return {
      from: endpoint(p.arp.senderIp, p.arp.senderMac, 'from'),
      to: p.arp.op === 'request' ? { everyone: true } : endpoint(p.arp.targetIp, p.arp.targetMac, 'to'),
    };
  }
  return {
    from: endpoint(ip && ip.src, eth.src, 'from'),
    to: endpoint(ip && ip.dst, eth.dst, 'to'),
  };
}

/** « PC1 → tous » (ou « PC1 → all » en anglais). */
export function packetCaption(packet, lookup, lang = 'fr') {
  const { from, to } = packetParties(packet, lookup);
  const words = lang === 'en' ? { everyone: 'all', group: 'group' } : { everyone: 'tous', group: 'groupe' };
  const show = (party) => (party.everyone ? words.everyone : party.group ? words.group : party.name);
  return `${show(from)} → ${show(to)}`;
}

/** Légende : [{ id, name, color }] dans l'ordre d'affichage. */
export function legend() {
  return Object.keys(PROTOCOL_COLORS).map((id) => ({ id, name: PROTOCOL_NAMES[id], color: PROTOCOL_COLORS[id] }));
}
