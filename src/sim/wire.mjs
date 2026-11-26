// Le paquet « tel qu'il passe sur le câble » : chaque en-tête champ par champ, comme dans un
// analyseur de trames (Wireshark), pour l'inspecteur de paquet.
//
// La simulation ne transporte que l'essentiel (adresses, ports, TTL, indicateurs…). Ce module
// reconstruit les octets de la trame à partir de ces champs — en-têtes Ethernet, ARP, IPv4,
// IPv6, ICMP, ICMPv6, UDP, TCP, et messages DNS et DHCP au vrai format — puis calcule ce qui en
// découle comme sur un vrai réseau : longueurs, somme de contrôle de l'en-tête IPv4, sommes de
// contrôle ICMP/UDP/TCP (avec le pseudo-en-tête), CRC-32 de la trame (FCS).
// Le contenu applicatif reste simplifié (HTTP : le début de la requête ou de la réponse).
// Module pur, sans dépendance : testé dans tests/wire.test.mjs.

// ------------------------------------------------------------------ octets
const bytesOfText = (text) => Array.from(new TextEncoder().encode(String(text)));
const u16 = (value) => [(value >>> 8) & 0xff, value & 0xff];
const u32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const hex = (value, digits) => `0x${(value >>> 0).toString(16).padStart(digits, '0')}`;

export function macBytes(mac) {
  return String(mac || '00:00:00:00:00:00').split(/[:-]/).map((part) => parseInt(part, 16) & 0xff);
}
export function ipv4Bytes(ip) {
  return String(ip || '0.0.0.0').split('.').map((part) => Number(part) & 0xff);
}
/** Adresse IPv6 (forme abrégée acceptée : « :: », zéros omis) → 16 octets. */
export function ipv6Bytes(ip) {
  const text = String(ip || '::').toLowerCase();
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const parse = (part) => (part ? part.split(':').filter(Boolean).map((group) => parseInt(group, 16) & 0xffff) : []);
  const left = parse(head);
  const right = tail === null ? [] : parse(tail);
  const groups = tail === null ? left : [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];
  return groups.slice(0, 8).flatMap((group) => u16(group));
}

/** Somme de contrôle Internet (RFC 1071) : complément à un de la somme des mots de 16 bits. */
export function internetChecksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) + (i + 1 < bytes.length ? bytes[i + 1] : 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

let crcTable = null;
/** CRC-32 d'Ethernet (polynôme 0xEDB88320, comme le FCS d'une trame). */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Petit nombre stable tiré d'un texte (identification IPv4, identifiants), FNV-1a. */
function stable(text, bits = 16) {
  let hash = 2166136261;
  for (const ch of String(text)) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  return bits === 32 ? hash >>> 0 : hash & ((1 << bits) - 1);
}

// ------------------------------------------------------------------ messages applicatifs
const DNS_TYPES = { A: 1, NS: 2, CNAME: 5, MX: 15, AAAA: 28 };
const RCODES = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 };

/** Message DNS au format du protocole (en-tête, question, réponse éventuelle). */
export function dnsMessage(dns) {
  const response = dns.qr === 'response';
  const flags = (response ? 0x8000 : 0) | 0x0100 | (response ? 0x0080 : 0) | (RCODES[dns.rcode] || 0);
  const answers = response && dns.answer ? 1 : 0;
  const qname = String(dns.name || '').split('.').filter(Boolean).flatMap((label) => [label.length, ...bytesOfText(label)]);
  const type = DNS_TYPES[dns.type] || 1;
  const bytes = [...u16(Number(dns.id) || 0), ...u16(flags), ...u16(1), ...u16(answers), ...u16(0), ...u16(0), ...qname, 0, ...u16(type), ...u16(1)];
  if (answers) bytes.push(0xc0, 0x0c, ...u16(type), ...u16(1), ...u32(3600), ...u16(4), ...ipv4Bytes(dns.answer));
  return bytes;
}

const DHCP_TYPES = { DISCOVER: 1, OFFER: 2, REQUEST: 3, DECLINE: 4, ACK: 5, NAK: 6, RELEASE: 7, INFORM: 8 };
/** Message DHCP (BOOTP + options) : 240 octets fixes, puis les options utiles. */
export function dhcpMessage(dhcp) {
  const type = DHCP_TYPES[dhcp.type] || 1;
  const fromServer = type === 2 || type === 5 || type === 6;
  const xid = parseInt(String(dhcp.xid || '0'), 16) >>> 0;
  const chaddr = [...macBytes(dhcp.clientMac), ...new Array(10).fill(0)];
  const bytes = [fromServer ? 2 : 1, 1, 6, 0, ...u32(xid), ...u16(0), ...u16(0x8000),
    ...ipv4Bytes('0.0.0.0'), ...ipv4Bytes(dhcp.yourIp || '0.0.0.0'), ...ipv4Bytes(fromServer ? dhcp.serverId : '0.0.0.0'), ...ipv4Bytes('0.0.0.0'),
    ...chaddr, ...new Array(64 + 128).fill(0), 99, 130, 83, 99];
  const option = (code, data) => bytes.push(code, data.length, ...data);
  option(53, [type]);
  if (dhcp.requestedIp) option(50, ipv4Bytes(dhcp.requestedIp));
  if (dhcp.serverId) option(54, ipv4Bytes(dhcp.serverId));
  if (dhcp.mask) option(1, ipv4Bytes(dhcp.mask));
  if (dhcp.gateway) option(3, ipv4Bytes(dhcp.gateway));
  if (dhcp.dns) option(6, ipv4Bytes(dhcp.dns));
  if (fromServer && type !== 6) option(51, u32(Number(dhcp.lease) || 3600));
  bytes.push(255);
  return bytes;
}

/** Début du message HTTP (texte), coupé ou complété à `length` octets (longueur que la simulation transporte). */
function httpMessage(http, length) {
  const text = http.type === 'response'
    ? `${http.version || 'HTTP/1.1'} ${http.status} ${http.reason}\r\nContent-Type: ${http.contentType || 'text/html'}\r\nContent-Length: ${http.contentLength || 0}\r\n\r\n`
    : `${http.method || 'GET'} ${http.path || '/'} ${http.version || 'HTTP/1.1'}\r\nHost: ${http.host || ''}\r\n\r\n`;
  const bytes = bytesOfText(text);
  return length === undefined ? bytes : [...bytes.slice(0, length), ...new Array(Math.max(0, length - bytes.length)).fill(0x20)];
}

// ------------------------------------------------------------------ libellés
const L = (fr, en = fr) => ({ fr, en });
const PORT_NAMES = { 20: 'FTP-data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP (serveur)', 68: 'DHCP (client)', 80: 'HTTP', 443: 'HTTPS', 123: 'NTP', 161: 'SNMP' };
const portText = (port) => (PORT_NAMES[port] ? `${port} (${PORT_NAMES[port]})` : String(port));
const ETHERTYPES = { ARP: [0x0806, 'ARP'], IPv4: [0x0800, 'IPv4'], IPv6: [0x86dd, 'IPv6'] };
const IP_PROTOCOLS = { ICMP: 1, TCP: 6, UDP: 17, ICMPv6: 58 };
const TCP_FLAG_BITS = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10, URG: 0x20 };
const TCP_WINDOW = 64240;
const field = (label, value, note) => ({ label, value, ...(note ? { note } : {}) });

/**
 * Le paquet, en-tête par en-tête, avec les octets de la trame.
 * @param {Object} packet  paquet de la simulation (eth, arp, ip, ipv6, icmp, icmp6, udp, tcp, dns, dhcp, http, data)
 * @returns {{ layers: { id: string, title: {fr,en}, fields: { label: {fr,en}, value: string|number|{fr,en}, note?: {fr,en} }[] }[],
 *             bytes: number[], frameLength: number }}
 */
export function packetLayers(packet) {
  const layers = [];
  const eth = packet.eth || {};
  const [etherType, etherName] = ETHERTYPES[eth.type] || [0x0800, eth.type || '?'];

  // ---- charge utile de la couche transport (et message applicatif)
  let app = [];
  if (packet.dns) app = dnsMessage(packet.dns);
  else if (packet.dhcp) app = dhcpMessage(packet.dhcp);
  else if (packet.http) app = httpMessage(packet.http, packet.tcp ? packet.tcp.len : undefined);
  else if (packet.data) app = bytesOfText(packet.data);
  if (packet.tcp && !packet.http) app = [...app.slice(0, packet.tcp.len), ...new Array(Math.max(0, (packet.tcp.len || 0) - app.length)).fill(0)];

  // ---- couche réseau : adresses du pseudo-en-tête (sommes de contrôle UDP, TCP, ICMPv6)
  const v4 = !!packet.ip;
  const v6 = !!packet.ipv6;
  const pseudo = (proto, length) => (v6
    ? [...ipv6Bytes(packet.ipv6.src), ...ipv6Bytes(packet.ipv6.dst), ...u32(length), 0, 0, 0, proto]
    : [...ipv4Bytes(packet.ip.src), ...ipv4Bytes(packet.ip.dst), 0, proto, ...u16(length)]);

  // ---- couche transport (ou ICMP)
  let l4 = [];
  let l4Layer = null;
  if (packet.tcp) {
    const seg = packet.tcp;
    const flags = (seg.flags || []).reduce((acc, name) => acc | (TCP_FLAG_BITS[name] || 0), 0);
    const header = [...u16(seg.srcPort), ...u16(seg.dstPort), ...u32(seg.seq >>> 0), ...u32((seg.flags || []).includes('ACK') ? seg.ack >>> 0 : 0),
      5 << 4, flags, ...u16(TCP_WINDOW), 0, 0, 0, 0];
    const checksum = internetChecksum([...pseudo(6, header.length + app.length), ...header, ...app]);
    header[16] = checksum >>> 8; header[17] = checksum & 0xff;
    l4 = [...header, ...app];
    l4Layer = { id: 'tcp', title: L('TCP (couche transport)', 'TCP (transport layer)'), fields: [
      field(L('Port source', 'Source port'), portText(seg.srcPort)),
      field(L('Port destination', 'Destination port'), portText(seg.dstPort)),
      field(L('N° de séquence', 'Sequence number'), seg.seq),
      field(L('N° d\'acquittement', 'Acknowledgement number'), (seg.flags || []).includes('ACK') ? seg.ack : 0, (seg.flags || []).includes('ACK') ? null : L('non utilisé (pas d\'ACK)', 'unused (no ACK)')),
      field(L('Longueur d\'en-tête', 'Header length'), L('20 octets', '20 bytes')),
      field(L('Indicateurs', 'Flags'), `${hex(flags, 3)} (${(seg.flags || []).join(', ') || '—'})`),
      field(L('Fenêtre', 'Window'), TCP_WINDOW, L('octets que l\'émetteur peut encore recevoir', 'bytes the sender can still receive')),
      field(L('Somme de contrôle', 'Checksum'), hex(checksum, 4), L('calculée avec le pseudo-en-tête IP', 'computed with the IP pseudo-header')),
      field(L('Pointeur d\'urgence', 'Urgent pointer'), 0),
      field(L('Données', 'Payload'), L(`${app.length} octets`, `${app.length} bytes`)),
    ] };
  } else if (packet.udp) {
    const length = 8 + app.length;
    const header = [...u16(packet.udp.srcPort), ...u16(packet.udp.dstPort), ...u16(length), 0, 0];
    let checksum = internetChecksum([...pseudo(17, length), ...header, ...app]);
    if (checksum === 0) checksum = 0xffff;
    header[6] = checksum >>> 8; header[7] = checksum & 0xff;
    l4 = [...header, ...app];
    l4Layer = { id: 'udp', title: L('UDP (couche transport)', 'UDP (transport layer)'), fields: [
      field(L('Port source', 'Source port'), portText(packet.udp.srcPort)),
      field(L('Port destination', 'Destination port'), portText(packet.udp.dstPort)),
      field(L('Longueur', 'Length'), L(`${length} octets (8 d'en-tête + ${app.length})`, `${length} bytes (8 header + ${app.length})`)),
      field(L('Somme de contrôle', 'Checksum'), hex(checksum, 4), L('calculée avec le pseudo-en-tête IP', 'computed with the IP pseudo-header')),
    ] };
  } else if (packet.icmp) {
    const icmp = packet.icmp;
    const echo = icmp.seq !== undefined;
    const rest = echo ? [...u16(Number(icmp.id) || 0), ...u16(Number(icmp.seq) || 0)] : [0, 0, 0, 0];
    const body = echo ? app : bytesOfText(icmp.about || '').slice(0, 28);
    const message = [icmp.type & 0xff, icmp.code & 0xff, 0, 0, ...rest, ...body];
    const checksum = internetChecksum(message);
    message[2] = checksum >>> 8; message[3] = checksum & 0xff;
    l4 = message;
    l4Layer = { id: 'icmp', title: L('ICMP (messages de contrôle)', 'ICMP (control messages)'), fields: [
      field(L('Type', 'Type'), `${icmp.type} (${icmp.name || '?'})`),
      field(L('Code', 'Code'), icmp.code),
      field(L('Somme de contrôle', 'Checksum'), hex(checksum, 4)),
      ...(echo ? [field(L('Identifiant', 'Identifier'), icmp.id), field(L('N° de séquence', 'Sequence number'), icmp.seq),
        field(L('Données', 'Data'), packet.data ? `« ${packet.data} » (${app.length})` : L('aucune', 'none'))]
        : [field(L('Paquet d\'origine', 'Original packet'), icmp.about || '—', L('l\'en-tête IP et le début du paquet qui a causé l\'erreur', 'the IP header and start of the packet that caused the error'))]),
    ] };
  } else if (packet.icmp6) {
    const msg = packet.icmp6;
    const echo = msg.seq !== undefined;
    const rest = echo ? [...u16(Number(msg.id) || 0), ...u16(Number(msg.seq) || 0)] : [msg.type === 136 ? 0x60 : 0, 0, 0, 0];
    const extra = msg.target ? ipv6Bytes(msg.target) : [];
    const option = msg.mac ? [2, 1, ...macBytes(msg.mac)] : (msg.type === 135 ? [1, 1, ...macBytes(eth.src)] : []);
    const message = [msg.type & 0xff, 0, 0, 0, ...rest, ...extra, ...option, ...(echo ? app : [])];
    const checksum = internetChecksum([...pseudo(58, message.length), ...message]);
    message[2] = checksum >>> 8; message[3] = checksum & 0xff;
    l4 = message;
    l4Layer = { id: 'icmp6', title: L('ICMPv6', 'ICMPv6'), fields: [
      field(L('Type', 'Type'), `${msg.type} (${msg.name || '?'})`),
      field(L('Code', 'Code'), 0),
      field(L('Somme de contrôle', 'Checksum'), hex(checksum, 4), L('calculée avec le pseudo-en-tête IPv6', 'computed with the IPv6 pseudo-header')),
      ...(msg.target ? [field(L('Adresse cible', 'Target address'), msg.target)] : []),
      ...(msg.mac ? [field(L('Option : adresse MAC', 'Option: link-layer address'), msg.mac)] : []),
      ...(echo ? [field(L('Identifiant', 'Identifier'), msg.id), field(L('N° de séquence', 'Sequence number'), msg.seq)] : []),
    ] };
  }

  // ---- couche réseau
  let l3 = [];
  let l3Layer = null;
  if (packet.arp) {
    const arp = packet.arp;
    const op = arp.op === 'reply' ? 2 : 1;
    l3 = [...u16(1), ...u16(0x0800), 6, 4, ...u16(op), ...macBytes(arp.senderMac), ...ipv4Bytes(arp.senderIp), ...macBytes(arp.targetMac), ...ipv4Bytes(arp.targetIp)];
    l3Layer = { id: 'arp', title: L('ARP (résolution d\'adresse)', 'ARP (address resolution)'), fields: [
      field(L('Type de matériel', 'Hardware type'), L('1 (Ethernet)', '1 (Ethernet)')),
      field(L('Type de protocole', 'Protocol type'), '0x0800 (IPv4)'),
      field(L('Taille des adresses', 'Address sizes'), L('MAC 6 octets, IP 4 octets', 'MAC 6 bytes, IP 4 bytes')),
      field(L('Opération', 'Opcode'), op === 1 ? L('1 (requête)', '1 (request)') : L('2 (réponse)', '2 (reply)')),
      field(L('MAC de l\'émetteur', 'Sender MAC'), arp.senderMac),
      field(L('IP de l\'émetteur', 'Sender IP'), arp.senderIp),
      field(L('MAC cible', 'Target MAC'), arp.targetMac, op === 1 ? L('inconnue : c\'est ce que la requête demande', 'unknown: this is what the request asks') : null),
      field(L('IP cible', 'Target IP'), arp.targetIp),
    ] };
  } else if (v4) {
    const ip = packet.ip;
    const proto = IP_PROTOCOLS[ip.proto] ?? (packet.tcp ? 6 : packet.udp ? 17 : 1);
    const total = 20 + l4.length;
    const identification = stable(packet.id || `${ip.src}>${ip.dst}`);
    const df = packet.tcp ? 0x4000 : 0;
    const header = [0x45, 0, ...u16(total), ...u16(identification), ...u16(df), ip.ttl & 0xff, proto, 0, 0, ...ipv4Bytes(ip.src), ...ipv4Bytes(ip.dst)];
    const checksum = internetChecksum(header);
    header[10] = checksum >>> 8; header[11] = checksum & 0xff;
    l3 = [...header, ...l4];
    const protoName = Object.keys(IP_PROTOCOLS).find((name) => IP_PROTOCOLS[name] === proto) || '?';
    l3Layer = { id: 'ipv4', title: L('IPv4 (couche réseau)', 'IPv4 (network layer)'), fields: [
      field(L('Version', 'Version'), 4),
      field(L('Longueur d\'en-tête', 'Header length'), L('20 octets (IHL = 5)', '20 bytes (IHL = 5)')),
      field(L('Type de service (DSCP/ECN)', 'Type of service (DSCP/ECN)'), '0x00'),
      field(L('Longueur totale', 'Total length'), L(`${total} octets`, `${total} bytes`)),
      field(L('Identification', 'Identification'), hex(identification, 4)),
      field(L('Indicateurs', 'Flags'), df ? L('0x2 (DF : ne pas fragmenter)', '0x2 (DF: don\'t fragment)') : '0x0'),
      field(L('Décalage de fragment', 'Fragment offset'), 0),
      field(L('TTL (durée de vie)', 'TTL (time to live)'), ip.ttl, L('chaque routeur le diminue de 1 ; à 0, le paquet est détruit', 'each router lowers it by 1; at 0 the packet is destroyed')),
      field(L('Protocole', 'Protocol'), `${proto} (${protoName})`),
      field(L('Somme de contrôle de l\'en-tête', 'Header checksum'), hex(checksum, 4), L('recalculée par chaque routeur (le TTL change)', 'recomputed by each router (the TTL changes)')),
      field(L('Adresse source', 'Source address'), ip.src),
      field(L('Adresse destination', 'Destination address'), ip.dst),
    ] };
  } else if (v6) {
    const ip = packet.ipv6;
    const next = IP_PROTOCOLS[ip.next] ?? 58;
    l3 = [0x60, 0, 0, 0, ...u16(l4.length), next, (ip.hopLimit ?? 64) & 0xff, ...ipv6Bytes(ip.src), ...ipv6Bytes(ip.dst), ...l4];
    l3Layer = { id: 'ipv6', title: L('IPv6 (couche réseau)', 'IPv6 (network layer)'), fields: [
      field(L('Version', 'Version'), 6),
      field(L('Classe de trafic', 'Traffic class'), '0x00'),
      field(L('Étiquette de flux', 'Flow label'), '0x00000'),
      field(L('Longueur des données', 'Payload length'), L(`${l4.length} octets`, `${l4.length} bytes`)),
      field(L('En-tête suivant', 'Next header'), `${next} (${ip.next || 'ICMPv6'})`),
      field(L('Limite de sauts', 'Hop limit'), ip.hopLimit ?? 64, L('l\'équivalent du TTL d\'IPv4', 'the IPv6 equivalent of the TTL')),
      field(L('Adresse source', 'Source address'), ip.src),
      field(L('Adresse destination', 'Destination address'), ip.dst),
    ] };
  }

  // ---- trame Ethernet : en-tête, bourrage jusqu'à 60 octets, puis FCS
  const header = [...macBytes(eth.dst), ...macBytes(eth.src), ...u16(etherType)];
  const body = [...l3];
  const padding = Math.max(0, 60 - header.length - body.length);
  const frame = [...header, ...body, ...new Array(padding).fill(0)];
  const fcs = crc32(frame);
  const bytes = [...frame, fcs & 0xff, (fcs >>> 8) & 0xff, (fcs >>> 16) & 0xff, (fcs >>> 24) & 0xff];
  const broadcast = String(eth.dst || '').toUpperCase() === 'FF:FF:FF:FF:FF:FF';
  const group = !broadcast && (parseInt(String(eth.dst || '00').slice(0, 2), 16) & 1) === 1;
  layers.push({ id: 'ethernet', title: L('Ethernet II (couche liaison)', 'Ethernet II (link layer)'), fields: [
    field(L('Destination', 'Destination'), eth.dst, broadcast ? L('diffusion : tout le réseau local', 'broadcast: the whole local network') : group ? L('multidiffusion : un groupe', 'multicast: a group') : null),
    field(L('Source', 'Source'), eth.src),
    field(L('Type (EtherType)', 'Type (EtherType)'), `${hex(etherType, 4)} (${etherName})`),
    ...(padding ? [field(L('Bourrage', 'Padding'), L(`${padding} octets`, `${padding} bytes`), L('une trame fait au moins 64 octets', 'a frame is at least 64 bytes long'))] : []),
    field(L('FCS (CRC-32)', 'FCS (CRC-32)'), hex(fcs, 8), L('permet au récepteur de détecter une trame abîmée', 'lets the receiver detect a damaged frame')),
    field(L('Taille de la trame', 'Frame size'), L(`${bytes.length} octets`, `${bytes.length} bytes`)),
  ] });
  if (l3Layer) layers.push(l3Layer);
  if (l4Layer) layers.push(l4Layer);
  return { layers, bytes, frameLength: bytes.length };
}

/** Octets en lignes de 16, façon analyseur : « 0000  ff ff ff …  ......... ». */
export function hexDump(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hexPart = row.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const text = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(4, '0')}  ${hexPart}  ${text}`);
  }
  return lines.join('\n');
}
