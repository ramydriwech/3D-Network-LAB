import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « ping » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('ping');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });

test('switch : apprend les adresses MAC source port par port', { skip }, async () => {
  const { sim, events } = await play('ping', only(0));
  const table = sim.device('sw1').macTable;
  assert.equal(table.get('02:00:00:00:01:10'), 'p1');
  assert.equal(table.get('02:00:00:00:01:11'), 'p2');
  assert.equal(table.size, 2);
  assert.ok(events.some((e) => e.topic === Topics.DEVICE_UPDATE && e.device === 'sw1' && e.what === 'mac'));
  assert.deepEqual(sim.device('sw1').tables()[0].rows, [['02:00:00:00:01:10', 'p1'], ['02:00:00:00:01:11', 'p2']]);
});

test('switch : une diffusion sort par tous les ports sauf celui d\'arrivée', { skip }, async () => {
  const { sim, events } = await play('ping', only(0));
  const all = sends(events, sim);
  assert.ok(all.includes('SW1>PC2 ARP Request'));
  assert.ok(all.includes('SW1>R1 ARP Request'));
  assert.ok(!all.includes('SW1>PC1 ARP Request'), 'jamais renvoyée vers l\'émetteur');
  assert.ok(noteKeys(events).includes('switch.flood.broadcast'));
});

test('switch : destination connue, un seul port de sortie', { skip }, async () => {
  const { sim, events } = await play('ping', only(0));
  const all = sends(events, sim);
  assert.equal(all.filter((line) => line.startsWith('SW1>') && line.endsWith('ICMP Echo Request')).length, 1);
  assert.equal(all.filter((line) => line.startsWith('SW1>') && line.endsWith('ARP Reply')).length, 1);
  assert.ok(noteKeys(events).includes('switch.forward'));
});

test('switch : destination inconnue, la trame est inondée', { skip }, async () => {
  const { sim, events } = await loadSim('ping', (scenario) => ({ ...scenario, steps: [] }));
  const pc1 = sim.device('pc1');
  const frame = sim.network.packet({
    protocol: 'ip', label: 'Trame test',
    eth: { src: '02:00:00:00:01:10', dst: '02:00:00:00:01:77', type: 'IPv4' },
    ip: { src: '192.168.1.10', dst: '192.168.1.77', ttl: 64, proto: 'TEST' },
  });
  sim.network.transmit(pc1, 'eth0', frame);
  sim.engine.runToEnd();
  assert.deepEqual(sends(events, sim), ['PC1>SW1 Trame test', 'SW1>PC2 Trame test', 'SW1>R1 Trame test']);
  const keys = noteKeys(events);
  assert.ok(keys.includes('switch.flood.unknown'));
  assert.ok(keys.includes('host.notForMe'), 'les hôtes qui ne sont pas destinataires ignorent la trame');
});

test('switch : une trame dont la destination est sur le port d\'arrivée n\'est pas relayée', { skip }, async () => {
  const { sim, events } = await loadSim('ping', (scenario) => ({ ...scenario, steps: [] }));
  const sw1 = sim.device('sw1');
  sw1.macTable.set('02:00:00:00:01:55', 'p1');
  const frame = sim.network.packet({
    protocol: 'ip', label: 'Trame test',
    eth: { src: '02:00:00:00:01:10', dst: '02:00:00:00:01:55', type: 'IPv4' },
  });
  const result = sw1.receive(frame, 'p1');
  sim.engine.runToEnd();
  assert.equal(sends(events, sim).length, 0);
  assert.ok(result.notes.some((n) => n.key === 'switch.filter'));
});
