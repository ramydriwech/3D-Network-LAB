import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import udp from '../src/sim/protocols/udp.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « udp » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('udp');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });

test('UDP : un datagramme vers un port ouvert, et rien en retour', { skip }, async () => {
  const { sim, events } = await play('udp', only(0));
  const lines = sends(events, sim).filter((line) => line.includes('UDP'));
  assert.deepEqual(lines, ['PC1>SW1 UDP 49152 → 5005', 'SW1>SRV1 UDP 49152 → 5005']);
  const packet = events.find((e) => e.topic === Topics.PACKET_SEND && e.packet.udp).packet;
  assert.deepEqual(packet.udp, { srcPort: 49152, dstPort: 5005, length: 8 + 'temperature=21'.length });
  assert.equal(packet.ip.proto, 'UDP');
  assert.equal(packet.data, 'temperature=21');
  assert.ok(noteKeys(events).includes('udp.delivered'));
  assert.equal(sends(events, sim).some((line) => line.startsWith('SRV1>') && !line.includes('ARP')), false, 'le serveur ne renvoie rien');
});

test('UDP : port fermé, le datagramme est détruit et ICMP prévient l\'émetteur', { skip }, async () => {
  const { sim, events } = await play('udp', only(1));
  assert.ok(sends(events, sim).includes('SW1>PC1 ICMP Destination Unreachable (port)'));
  assert.ok(events.some((e) => e.topic === Topics.PACKET_DROP && e.device === 'srv1'));
  const error = events.find((e) => e.topic === Topics.PACKET_SEND && e.packet.icmp).packet;
  assert.equal(error.icmp.type, 3);
  assert.equal(error.icmp.code, 3);
  assert.ok(noteKeys(events).includes('icmp.errorReceived'));
});

test('UDP : les ports temporaires se suivent, une application peut s\'abonner à un port', { skip }, async () => {
  const { sim, events } = await loadSim('udp', (scenario) => ({ ...scenario, steps: [] }));
  const pc1 = sim.device('pc1');
  const pc2 = sim.device('pc2');
  const received = [];
  udp.bind(pc2, 7000, (packet) => { received.push(packet.data); });
  udp.send(pc1, { dst: '192.168.1.11', dstPort: 7000, data: 'un' });
  udp.send(pc1, { dst: '192.168.1.11', dstPort: 7000, data: 'deux' });
  sim.engine.runToEnd();
  assert.deepEqual(received, ['un', 'deux']);
  const ports = events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.udp && e.from === 'pc1').map((e) => e.packet.udp.srcPort);
  assert.deepEqual(ports, [49152, 49153]);
  assert.equal(udp.describe({ udp: { srcPort: 1, dstPort: 2, length: 9 } }).length, 3);
  assert.deepEqual(udp.describe({}), []);
});
