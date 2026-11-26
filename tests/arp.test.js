import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import arp, { ARP_TIMEOUT } from '../src/sim/protocols/arp.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « ping » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('ping');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });

test('ARP : requête en diffusion, réponse en unicast, caches mis à jour', { skip }, async () => {
  const { sim, events } = await play('ping', only(0));
  const all = sends(events, sim);

  // La requête part de PC1, le switch l'inonde vers PC2 et vers le routeur.
  assert.deepEqual(all.slice(0, 3), ['PC1>SW1 ARP Request', 'SW1>PC2 ARP Request', 'SW1>R1 ARP Request']);
  assert.ok(all.includes('PC2>SW1 ARP Reply') && all.includes('SW1>PC1 ARP Reply'));
  assert.ok(!all.includes('SW1>R1 ARP Reply'), 'la réponse, unicast, ne va pas vers le routeur');

  const request = events.find((e) => e.topic === Topics.PACKET_SEND && e.packet.label === 'ARP Request').packet;
  assert.equal(request.cast, 'broadcast');
  assert.equal(request.eth.dst, 'FF:FF:FF:FF:FF:FF');
  assert.deepEqual(request.arp, {
    op: 'request', senderMac: '02:00:00:00:01:10', senderIp: '192.168.1.10',
    targetMac: '00:00:00:00:00:00', targetIp: '192.168.1.11',
  });
  const reply = events.find((e) => e.topic === Topics.PACKET_SEND && e.packet.label === 'ARP Reply').packet;
  assert.equal(reply.cast, 'unicast');
  assert.equal(reply.eth.dst, '02:00:00:00:01:10');
  assert.equal(reply.arp.senderMac, '02:00:00:00:01:11');

  assert.equal(sim.device('pc1').arpCache.get('192.168.1.11'), '02:00:00:00:01:11');
  assert.equal(sim.device('pc2').arpCache.get('192.168.1.10'), '02:00:00:00:01:10');
  assert.equal(sim.device('r1').arpCache.size, 0, 'le routeur n\'était pas visé : il n\'apprend rien');
  assert.ok(noteKeys(events).includes('arp.notForMe'));
});

test('ARP : le cache évite une seconde requête', { skip }, async () => {
  const { sim, events } = await play('ping', (scenario) => ({ ...scenario, steps: [scenario.steps[0], scenario.steps[0]] }));
  const requests = sends(events, sim).filter((line) => line === 'PC1>SW1 ARP Request');
  assert.equal(requests.length, 1);
  assert.ok(noteKeys(events).includes('arp.cacheHit'));
  assert.equal(sends(events, sim).filter((line) => line === 'PC1>SW1 ICMP Echo Request').length, 2);
});

test('ARP : hors de son réseau, l\'hôte cherche la MAC de la passerelle', { skip }, async () => {
  const { sim, events } = await play('ping', only(1));
  const requests = events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.label === 'ARP Request' && e.from === 'pc1');
  assert.equal(requests[0].packet.arp.targetIp, '192.168.1.1', 'PC1 demande R1, pas PC3');
  const fromRouter = events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.label === 'ARP Request' && e.from === 'r1');
  assert.equal(fromRouter[0].packet.arp.targetIp, '192.168.2.10', 'R1 demande PC3 de l\'autre côté');
  assert.equal(fromRouter[0].packet.arp.senderIp, '192.168.2.1');
  assert.equal(sim.device('pc1').arpCache.has('192.168.2.10'), false);
  assert.ok(noteKeys(events).includes('host.viaGateway'));
});

test('ARP : sans réponse, la résolution échoue après le délai', { skip }, async () => {
  const { sim, events } = await play('ping', (scenario) => ({
    ...scenario,
    steps: [{ action: 'ping', from: 'pc1', to: '192.168.1.99' }],
  }));
  const keys = noteKeys(events);
  assert.ok(keys.includes('arp.timeout'));
  assert.ok(keys.includes('host.unreachable'));
  assert.ok(sim.now >= ARP_TIMEOUT);
  assert.equal(sends(events, sim).some((line) => line.includes('ICMP')), false);
});

test('ARP : lignes de l\'inspecteur', { skip }, async () => {
  const { events } = await play('ping', only(0));
  const request = events.find((e) => e.topic === Topics.PACKET_SEND).packet;
  const rows = arp.describe(request);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].value, '192.168.1.11');
  assert.deepEqual(arp.describe({}), []);
});

test('ARP : deux paquets en attente de la même adresse ne déclenchent qu\'une requête', { skip }, async () => {
  const { sim, events } = await loadSim('ping', (scenario) => ({ ...scenario, steps: [] }));
  const pc1 = sim.device('pc1');
  const send = (seq) => pc1.sendIp({
    dst: '192.168.1.11', proto: 'ICMP', protocol: 'icmp', label: 'ICMP Echo Request',
    icmp: { type: 8, code: 0, name: 'Echo Request', id: 9, seq },
  });
  send(1);
  send(2);
  sim.engine.runToEnd();
  const all = sends(events, sim);
  assert.equal(all.filter((line) => line === 'PC1>SW1 ARP Request').length, 1);
  assert.equal(all.filter((line) => line === 'PC1>SW1 ICMP Echo Request').length, 2);
});
