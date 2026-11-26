// Le paquet tel qu'il passe sur le câble : octets, longueurs et sommes de contrôle (src/sim/wire.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internetChecksum, crc32, ipv6Bytes, packetLayers, dnsMessage, dhcpMessage, hexDump } from '../src/sim/wire.mjs';

const field = (layer, fr) => layer.fields.find((f) => f.label.fr === fr);
const value = (v) => (v && typeof v === 'object' ? v.fr : v);

test('fil : somme de contrôle Internet et CRC-32 (valeurs de référence)', () => {
  // En-tête IPv4 d'exemple (somme de contrôle attendue 0xB861).
  const header = [0x45, 0x00, 0x00, 0x73, 0x00, 0x00, 0x40, 0x00, 0x40, 0x11, 0, 0, 0xc0, 0xa8, 0x00, 0x01, 0xc0, 0xa8, 0x00, 0xc7];
  assert.equal(internetChecksum(header), 0xb861);
  assert.equal(crc32(Array.from(new TextEncoder().encode('123456789'))), 0xcbf43926);
  assert.deepEqual(ipv6Bytes('2001:db8::1').slice(0, 4), [0x20, 0x01, 0x0d, 0xb8]);
  assert.equal(ipv6Bytes('ff02::1:ff00:0011').length, 16);
  assert.deepEqual(ipv6Bytes('ff02::1:ff00:0011').slice(-4), [0xff, 0x00, 0x00, 0x11]);
});

const echo = {
  id: 'p1', protocol: 'icmp', label: 'ICMP Echo Request',
  eth: { src: '02:00:00:00:01:10', dst: '02:00:00:00:01:11', type: 'IPv4' },
  ip: { src: '192.168.1.10', dst: '192.168.1.11', ttl: 64, proto: 'ICMP' },
  icmp: { type: 8, code: 0, name: 'Echo Request', id: 1, seq: 1 }, data: 'abcdefgh',
};

test('fil : ICMP Echo Request — couches, longueurs, sommes de contrôle valides', () => {
  const { layers, bytes } = packetLayers(echo);
  assert.deepEqual(layers.map((l) => l.id), ['ethernet', 'ipv4', 'icmp']);
  const [ethernet, ipv4, icmp] = layers;
  assert.equal(field(ethernet, 'Type (EtherType)').value, '0x0800 (IPv4)');
  assert.equal(value(field(ipv4, 'Longueur totale').value), '36 octets'); // 20 IP + 8 ICMP + 8 données
  assert.equal(field(ipv4, 'Protocole').value, '1 (ICMP)');
  // L'en-tête IPv4 (octets 14 à 33) avec sa somme de contrôle donne 0 : elle est juste.
  assert.equal(internetChecksum(bytes.slice(14, 34)), 0);
  // Le message ICMP (octets 34 à 49) aussi.
  assert.equal(internetChecksum(bytes.slice(34, 50)), 0);
  // Trame minimale : 60 octets + 4 de FCS ; le FCS est le CRC-32 de tout ce qui précède.
  assert.equal(bytes.length, 64);
  const fcs = bytes[60] | (bytes[61] << 8) | (bytes[62] << 16) | (bytes[63] << 24);
  assert.equal(fcs >>> 0, crc32(bytes.slice(0, 60)));
  assert.match(hexDump(bytes).split('\n')[0], /^0000 {2}02 00 00 00 01 11 02 00/);
});

test('fil : ARP — requête en diffusion, MAC cible inconnue', () => {
  const { layers, bytes } = packetLayers({
    protocol: 'arp', label: 'ARP Request', eth: { src: '02:00:00:00:01:10', dst: 'FF:FF:FF:FF:FF:FF', type: 'ARP' },
    arp: { op: 'request', senderMac: '02:00:00:00:01:10', senderIp: '192.168.1.10', targetMac: '00:00:00:00:00:00', targetIp: '192.168.1.11' },
  });
  assert.deepEqual(layers.map((l) => l.id), ['ethernet', 'arp']);
  assert.equal(value(field(layers[1], 'Opération').value), '1 (requête)');
  assert.ok(field(layers[0], 'Destination').note); // « diffusion »
  assert.deepEqual(bytes.slice(12, 14), [0x08, 0x06]);
});

test('fil : TCP et UDP — sommes de contrôle avec le pseudo-en-tête', () => {
  const tcp = {
    id: 't1', protocol: 'tcp', label: 'TCP SYN', eth: { src: '02:00:00:00:01:10', dst: '02:00:00:00:01:20', type: 'IPv4' },
    ip: { src: '192.168.1.10', dst: '192.168.1.20', ttl: 64, proto: 'TCP' },
    tcp: { srcPort: 49152, dstPort: 5000, flags: ['SYN'], seq: 1000, ack: 0, len: 0 },
  };
  const t = packetLayers(tcp);
  const segment = t.bytes.slice(34, 54);
  const pseudo = [192, 168, 1, 10, 192, 168, 1, 20, 0, 6, 0, 20];
  assert.equal(internetChecksum([...pseudo, ...segment]), 0);
  assert.equal(field(t.layers[2], 'Indicateurs').value, '0x002 (SYN)');
  assert.equal(value(field(t.layers[1], 'Indicateurs').value), '0x2 (DF : ne pas fragmenter)');

  const dns = {
    id: 'd1', protocol: 'dns', label: 'DNS Query', eth: { src: '02:00:00:00:01:10', dst: '02:00:00:00:01:53', type: 'IPv4' },
    ip: { src: '192.168.1.10', dst: '192.168.1.53', ttl: 64, proto: 'UDP' },
    udp: { srcPort: 49152, dstPort: 53, length: 8 }, dns: { id: 1, qr: 'query', name: 'www.supcom.tn', type: 'A' },
  };
  const d = packetLayers(dns);
  const message = dnsMessage(dns.dns);
  assert.equal(message.length, 12 + 15 + 4); // en-tête + « 3www6supcom2tn0 » + type et classe
  const udpLength = 8 + message.length;
  assert.equal(value(field(d.layers[2], 'Longueur').value), `${udpLength} octets (8 d'en-tête + ${message.length})`);
  assert.equal(field(d.layers[2], 'Port destination').value, '53 (DNS)');
  const datagram = d.bytes.slice(34, 34 + udpLength);
  assert.equal(internetChecksum([192, 168, 1, 10, 192, 168, 1, 53, 0, 17, 0, udpLength, ...datagram]), 0);
});

test('fil : DHCP au format BOOTP, IPv6 et ICMPv6', () => {
  const discover = dhcpMessage({ type: 'DISCOVER', xid: '0x000001aa', clientMac: '02:00:00:00:01:AA' });
  assert.deepEqual(discover.slice(236, 240), [99, 130, 83, 99]); // « magic cookie »
  assert.deepEqual(discover.slice(240, 243), [53, 1, 1]); // option 53 : DHCPDISCOVER
  const ns = packetLayers({
    protocol: 'ipv6', label: 'Neighbor Solicitation', eth: { src: '02:00:00:00:06:10', dst: '33:33:FF:00:00:11', type: 'IPv6' },
    ipv6: { src: '2001:db8:6::10', dst: 'ff02::1:ff00:0011', hopLimit: 255, next: 'ICMPv6' },
    icmp6: { type: 135, name: 'Neighbor Solicitation', target: '2001:db8:6::11' },
  });
  assert.deepEqual(ns.layers.map((l) => l.id), ['ethernet', 'ipv6', 'icmp6']);
  assert.ok(field(ns.layers[0], 'Destination').note); // multidiffusion
  const payload = ns.bytes.slice(54, 54 + Number(String(value(field(ns.layers[1], 'Longueur des données').value)).split(' ')[0]));
  const pseudo = [...ipv6Bytes('2001:db8:6::10'), ...ipv6Bytes('ff02::1:ff00:0011'), 0, 0, 0, payload.length, 0, 0, 0, 58];
  assert.equal(internetChecksum([...pseudo, ...payload]), 0);
});
