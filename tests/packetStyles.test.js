import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_IDS } from '../src/sim/events.js';
import {
  PROTOCOL_COLORS, PROTOCOL_NAMES, packetColor, packetStyle, packetParties, packetCaption, legend,
} from '../src/render/packetStyles.js';

test('styles : une couleur différente pour chacun des 9 protocoles du contrat', () => {
  assert.deepEqual(Object.keys(PROTOCOL_COLORS).sort(), [...PROTOCOL_IDS].sort());
  const colors = Object.values(PROTOCOL_COLORS);
  assert.equal(new Set(colors).size, 9, 'deux protocoles ne partagent jamais une couleur');
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
  for (const id of PROTOCOL_IDS) assert.ok(PROTOCOL_NAMES[id], `nom affiché manquant pour ${id}`);
});

test('styles : couleur du protocole et type de diffusion', () => {
  assert.deepEqual(packetStyle({ protocol: 'arp', cast: 'broadcast' }), { color: PROTOCOL_COLORS.arp, cast: 'broadcast' });
  assert.deepEqual(packetStyle({ protocol: 'ipv6', cast: 'multicast' }), { color: PROTOCOL_COLORS.ipv6, cast: 'multicast' });
  assert.equal(packetStyle({ protocol: 'tcp' }).cast, 'unicast', 'sans indication : unicast');
  assert.equal(packetStyle(null).cast, 'unicast');
});

test('styles : qui parle à qui (IP de bout en bout, sinon MAC ; diffusion = « tous »)', () => {
  const names = { '192.168.1.10': 'PC1', '192.168.2.10': 'PC3', '192.168.1.1': 'R1' };
  const macs = { '02:00:00:00:01:10': 'PC1' };
  const lookup = { nameOfIp: (ip) => names[ip] || null, nameOfMac: (mac) => macs[mac] || null };
  const ping = { protocol: 'icmp', cast: 'unicast', ip: { src: '192.168.1.10', dst: '192.168.2.10' }, eth: { src: '02:00:00:00:01:01', dst: '02:00:00:00:02:10' } };
  assert.equal(packetCaption(ping, lookup), 'PC1 → PC3', 'bout en bout, même sur le câble derrière le routeur');
  const arpRequest = { protocol: 'arp', cast: 'broadcast', arp: { op: 'request', senderIp: '192.168.1.10', targetIp: '192.168.1.1' } };
  assert.equal(packetCaption(arpRequest, lookup), 'PC1 → tous');
  assert.equal(packetCaption(arpRequest, lookup, 'en'), 'PC1 → all');
  const arpReply = { protocol: 'arp', arp: { op: 'reply', senderIp: '192.168.1.1', targetIp: '192.168.1.10' } };
  assert.equal(packetCaption(arpReply, lookup), 'R1 → PC1');
  const discover = { protocol: 'dhcp', cast: 'broadcast', ip: { src: '0.0.0.0', dst: '255.255.255.255' }, eth: { src: '02:00:00:00:01:10', dst: 'FF:FF:FF:FF:FF:FF' } };
  assert.equal(packetCaption(discover, lookup), 'PC1 → tous', 'sans adresse IP : on reconnaît la MAC');
  const solicitation = { protocol: 'ipv6', cast: 'multicast', ipv6: { src: '192.168.1.10', dst: 'ff02::1:ff00:11' } };
  assert.equal(packetCaption(solicitation, lookup), 'PC1 → groupe');
  assert.deepEqual(packetParties({ protocol: 'ip' }, lookup), { from: { name: '?' }, to: { name: '?' } });
});

test('styles : protocole inconnu = couleur de repli, légende complète', () => {
  assert.match(packetColor({ protocol: 'inconnu' }), /^#[0-9a-f]{6}$/);
  assert.match(packetColor(null), /^#[0-9a-f]{6}$/);
  assert.deepEqual(legend().map((item) => item.id), Object.keys(PROTOCOL_COLORS));
});
