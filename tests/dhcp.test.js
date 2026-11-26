import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import dhcp from '../src/sim/protocols/dhcp.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « dhcp » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('dhcp');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
/** Messages DHCP tels qu'émis par leur auteur (on ignore les recopies du switch). */
const messages = (events) => events
  .filter((e) => e.topic === Topics.PACKET_SEND && e.packet.dhcp && e.from !== 'sw1')
  .map((e) => e.packet);

test('DHCP : les quatre messages Discover, Offer, Request, Ack', { skip }, async () => {
  const { events } = await play('dhcp', only(0));
  const all = messages(events);
  assert.deepEqual(all.map((p) => p.label), ['DHCP Discover', 'DHCP Offer', 'DHCP Request', 'DHCP Ack']);
  const [discover, offer, request, ack] = all;

  assert.equal(discover.ip.src, '0.0.0.0', 'le client n\'a pas encore d\'adresse');
  assert.equal(discover.ip.dst, '255.255.255.255');
  assert.equal(discover.eth.dst, 'FF:FF:FF:FF:FF:FF');
  assert.deepEqual([discover.udp.srcPort, discover.udp.dstPort], [68, 67]);
  assert.deepEqual([offer.udp.srcPort, offer.udp.dstPort], [67, 68]);

  assert.equal(offer.dhcp.yourIp, '192.168.1.100', 'première adresse de la réserve');
  assert.equal(offer.dhcp.mask, '255.255.255.0');
  assert.equal(request.dhcp.requestedIp, '192.168.1.100');
  assert.equal(request.dhcp.serverId, '192.168.1.2');
  assert.equal(ack.dhcp.lease, 3600);
  assert.equal(new Set(all.map((p) => p.dhcp.xid)).size, 1, 'même identifiant de transaction partout');
});

test('DHCP : le client applique la configuration reçue', { skip }, async () => {
  const { sim, events } = await play('dhcp', only(0));
  const pc1 = sim.device('pc1');
  assert.equal(pc1.primary().ip, '192.168.1.100');
  assert.equal(pc1.primary().prefix, 24);
  assert.equal(pc1.gateway, '192.168.1.1');
  assert.equal(pc1.dnsServer, '192.168.1.2');
  assert.equal(pc1.dhcpClient.state, 'BOUND');
  assert.ok(events.some((e) => e.topic === Topics.DEVICE_UPDATE && e.device === 'pc1' && e.what === 'ip'));
  assert.deepEqual(dhcp.table(sim.device('dhcp1')).rows, [['02:00:00:00:01:AA', '192.168.1.100']]);
  const keys = noteKeys(events);
  assert.ok(keys.includes('dhcp.bound'));
  assert.ok(keys.includes('dhcp.notMine'), 'PC2 voit passer les diffusions et les ignore');
  assert.equal(sim.device('pc2').primary().ip, '192.168.1.11', 'un poste configuré à la main n\'est pas modifié');
});

test('DHCP : une fois configuré, le poste communique normalement', { skip }, async () => {
  const { sim, events } = await play('dhcp');
  assert.ok(sends(events, sim).includes('SW1>PC1 ICMP Echo Reply'));
  const request = events.find((e) => e.topic === Topics.PACKET_SEND && e.packet.label === 'ICMP Echo Request').packet;
  assert.equal(request.ip.src, '192.168.1.100');
});

test('DHCP : deux clients reçoivent deux adresses différentes ; réserve épuisée', { skip }, async () => {
  const twoClients = (scenario) => {
    const copy = structuredClone(scenario);
    delete copy.devices[1].interfaces[0].ip;
    delete copy.devices[1].interfaces[0].prefix;
    copy.steps = [{ action: 'dhcp', from: 'pc1' }, { action: 'dhcp', from: 'pc2' }];
    return copy;
  };
  const { sim } = await play('dhcp', twoClients);
  assert.equal(sim.device('pc1').primary().ip, '192.168.1.100');
  assert.equal(sim.device('pc2').primary().ip, '192.168.1.101');

  const tinyPool = (scenario) => {
    const copy = twoClients(scenario);
    copy.devices[3].services.dhcp.end = '192.168.1.100';
    return copy;
  };
  const second = await play('dhcp', tinyPool);
  assert.equal(second.sim.device('pc2').primary().ip, null);
  assert.ok(noteKeys(second.events).includes('dhcp.poolEmpty'));
});

test('DHCP : lignes de l\'inspecteur', { skip }, async () => {
  const { events } = await play('dhcp', only(0));
  const [discover, offer] = messages(events);
  assert.equal(dhcp.describe(discover).length, 3);
  assert.ok(dhcp.describe(offer).some((row) => row.value === '192.168.1.100'));
  assert.deepEqual(dhcp.describe({}), []);
});
