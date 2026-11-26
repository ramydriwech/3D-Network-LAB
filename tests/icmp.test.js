import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import icmp, { targetIp } from '../src/sim/protocols/icmp.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « ping » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('ping');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
const icmpSends = (events) => events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.icmp);

test('ICMP : ping dans le même réseau (demande puis réponse)', { skip }, async () => {
  const { sim, events } = await play('ping', only(0));
  const lines = sends(events, sim).filter((line) => line.includes('ICMP'));
  assert.deepEqual(lines, [
    'PC1>SW1 ICMP Echo Request', 'SW1>PC2 ICMP Echo Request',
    'PC2>SW1 ICMP Echo Reply', 'SW1>PC1 ICMP Echo Reply',
  ]);
  const [request, , reply] = icmpSends(events).map((e) => e.packet);
  assert.deepEqual(request.icmp, { type: 8, code: 0, name: 'Echo Request', id: 1, seq: 1 });
  assert.equal(request.ip.src, '192.168.1.10');
  assert.equal(request.ip.dst, '192.168.1.11');
  assert.equal(request.ip.ttl, 64);
  assert.equal(reply.icmp.type, 0);
  assert.equal(reply.icmp.seq, request.icmp.seq);
  assert.equal(reply.ip.dst, '192.168.1.10');
  assert.equal(reply.data, request.data, 'la réponse renvoie les mêmes données');
  assert.ok(noteKeys(events).includes('icmp.success'));
  assert.equal(sim.device('pc1').ping.received, 1);
});

test('ICMP : ping à travers le routeur, adresses IP conservées de bout en bout', { skip }, async () => {
  const { sim, events } = await play('ping', only(1));
  const lines = sends(events, sim).filter((line) => line.includes('ICMP'));
  assert.deepEqual(lines, [
    'PC1>SW1 ICMP Echo Request', 'SW1>R1 ICMP Echo Request', 'R1>SW2 ICMP Echo Request', 'SW2>PC3 ICMP Echo Request',
    'PC3>SW2 ICMP Echo Reply', 'SW2>R1 ICMP Echo Reply', 'R1>SW1 ICMP Echo Reply', 'SW1>PC1 ICMP Echo Reply',
  ]);
  const hops = icmpSends(events).map((e) => e.packet);
  assert.equal(hops[0].eth.dst, '02:00:00:00:01:01', 'premier saut : la trame vise la MAC du routeur');
  assert.equal(hops[2].eth.src, '02:00:00:00:02:01', 'après le routeur : la MAC source est celle de R1');
  assert.equal(hops[2].eth.dst, '02:00:00:00:02:10');
  for (const hop of hops.slice(0, 4)) {
    assert.equal(hop.ip.src, '192.168.1.10');
    assert.equal(hop.ip.dst, '192.168.2.10');
  }
  assert.equal(hops[0].flow, hops[3].flow, 'le même message est suivi de saut en saut');
  assert.ok(noteKeys(events).includes('icmp.success'));
});

test('ICMP : plusieurs pings se suivent, un par un', { skip }, async () => {
  const { sim, events } = await play('ping', (scenario) => ({
    ...scenario, steps: [{ action: 'ping', from: 'pc1', to: 'pc2', count: 3 }],
  }));
  const seqs = icmpSends(events).filter((e) => e.from === 'pc1').map((e) => e.packet.icmp.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
  assert.equal(sim.device('pc1').ping.received, 3);
});

test('ICMP : cible donnée par identifiant ou par adresse', { skip }, async () => {
  const { sim } = await loadSim('ping');
  assert.equal(targetIp(sim.network, 'pc3'), '192.168.2.10');
  assert.equal(targetIp(sim.network, '10.9.9.9'), '10.9.9.9');
  assert.equal(icmp.start(sim.network, { action: 'ping', from: 'sw1', to: 'pc2' }), false, 'un switch ne peut pas lancer de ping');
});

test('ICMP : destination sans route, le routeur renvoie « Destination Unreachable »', { skip }, async () => {
  const { sim, events } = await play('ping', (scenario) => ({
    ...scenario, steps: [{ action: 'ping', from: 'pc1', to: '10.50.0.1' }],
  }));
  const lines = sends(events, sim);
  assert.ok(lines.includes('R1>SW1 ICMP Destination Unreachable (network)'));
  const keys = noteKeys(events);
  assert.ok(keys.includes('router.noRoute'));
  assert.ok(keys.includes('icmp.errorReceived'));
  assert.ok(events.some((e) => e.topic === Topics.PACKET_DROP && e.device === 'r1'));
});

test('ICMP : pas d\'erreur ICMP en réponse à une erreur ICMP ; inspecteur', () => {
  const errorPacket = { label: 'x', ip: { src: '1.1.1.1' }, icmp: { type: 3, code: 0, name: 'Destination Unreachable' } };
  assert.equal(icmp.error({ sendIp: () => true, name: 'R' }, errorPacket, 'net'), false);
  const rows = icmp.describe({ icmp: { type: 8, code: 0, name: 'Echo Request', id: 1, seq: 4 } });
  assert.equal(rows[0].value, '8 — Echo Request');
  assert.equal(rows[3].value, 4);
});
