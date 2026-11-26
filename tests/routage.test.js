import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « routage » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('routage');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
const echoes = (events) => events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.icmp).map((e) => e.packet);

test('routage : la table contient les réseaux connectés et la route statique', { skip }, async () => {
  const { sim } = await loadSim('routage');
  const r1 = sim.device('r1');
  assert.deepEqual(r1.routeRows().map((row) => [row[0], typeof row[1] === 'string' ? row[1] : 'connecté', row[2]]), [
    ['10.0.1.0/24', 'connecté', 'g0/0'],
    ['10.0.12.0/30', 'connecté', 'g0/1'],
    ['10.0.2.0/24', '10.0.12.2', 'g0/1'],
  ]);
  assert.deepEqual([r1.lookup('10.0.2.10').nextHop, r1.lookup('10.0.2.10').iface.name], ['10.0.12.2', 'g0/1']);
  assert.equal(r1.lookup('10.0.1.10').nextHop, '10.0.1.10', 'réseau connecté : remise directe');
  assert.equal(r1.lookup('172.16.0.1'), null);
  assert.equal(r1.tables()[0].id, 'routes');
});

test('routage : le TTL diminue de 1 à chaque routeur, les adresses IP ne changent pas', { skip }, async () => {
  const { sim, events } = await play('routage', only(0));
  assert.deepEqual(sends(events, sim).filter((line) => line.includes('ICMP')), [
    'PC1>R1 ICMP Echo Request', 'R1>R2 ICMP Echo Request', 'R2>PC2 ICMP Echo Request',
    'PC2>R2 ICMP Echo Reply', 'R2>R1 ICMP Echo Reply', 'R1>PC1 ICMP Echo Reply',
  ]);
  const hops = echoes(events);
  assert.deepEqual(hops.map((p) => p.ip.ttl), [64, 63, 62, 64, 63, 62]);
  for (const hop of hops.slice(0, 3)) assert.deepEqual([hop.ip.src, hop.ip.dst], ['10.0.1.10', '10.0.2.10']);
  assert.deepEqual(hops.slice(0, 3).map((p) => p.eth.src), ['02:00:00:00:0A:10', '02:00:00:00:0C:01', '02:00:00:00:0B:01']);
  const keys = noteKeys(events);
  assert.ok(keys.includes('router.lookup') && keys.includes('router.ttl') && keys.includes('router.forward'));
  assert.ok(keys.includes('icmp.success'));
});

test('routage : TTL = 1, le premier routeur détruit le paquet et prévient la source', { skip }, async () => {
  const { sim, events } = await play('routage', only(1));
  assert.deepEqual(sends(events, sim).filter((line) => line.includes('ICMP')), ['PC1>R1 ICMP Echo Request', 'R1>PC1 ICMP Time Exceeded']);
  assert.ok(events.some((e) => e.topic === Topics.PACKET_DROP && e.device === 'r1'));
  const error = echoes(events)[1];
  assert.deepEqual([error.icmp.type, error.ip.src, error.ip.dst], [11, '10.0.1.1', '10.0.1.10']);
  assert.ok(noteKeys(events).includes('router.ttlExpired'));
});

test('routage : sans route, « Destination Unreachable »', { skip }, async () => {
  const { sim, events } = await play('routage', only(2));
  assert.ok(sends(events, sim).includes('R1>PC1 ICMP Destination Unreachable (network)'));
  assert.ok(noteKeys(events).includes('router.noRoute'));
});

test('routage : sans la route de retour sur R2, la réponse se perd', { skip }, async () => {
  const { sim, events } = await play('routage', (scenario) => {
    const copy = structuredClone(scenario);
    copy.devices.find((device) => device.id === 'r2').routes = [];
    copy.steps = [copy.steps[0]];
    return copy;
  });
  const lines = sends(events, sim);
  assert.ok(lines.includes('R2>PC2 ICMP Echo Request'), 'l\'aller fonctionne');
  assert.ok(lines.includes('PC2>R2 ICMP Echo Reply'));
  assert.ok(!lines.includes('R2>R1 ICMP Echo Reply'), 'le retour est impossible');
  assert.ok(!noteKeys(events).includes('icmp.success'));
});
