import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics, validateProtocol } from '../src/sim/events.js';
import ipv6, { expand, solicitedNode, solicitedMac } from '../src/sim/protocols/ipv6.js';
import { play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « ipv6 » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('ipv6');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });

test('IPv6 : le protocole respecte le contrat commun', () => {
  assert.deepEqual(validateProtocol(ipv6), []);
});

test('IPv6 : adresses de multidiffusion du nœud sollicité', () => {
  assert.deepEqual(expand('2001:db8:6::11'), [0x2001, 0xdb8, 6, 0, 0, 0, 0, 0x11]);
  assert.equal(solicitedNode('2001:db8:6::11'), 'ff02::1:ff00:0011');
  assert.equal(solicitedMac('2001:db8:6::11'), '33:33:FF:00:00:11');
  assert.equal(solicitedMac('2001:db8::abcd:1234'), '33:33:FF:CD:12:34');
});

test('IPv6 : sollicitation en multidiffusion, annonce, puis ping', { skip }, async () => {
  const { sim, events } = await play('ipv6', only(0));
  assert.deepEqual(sends(events, sim), [
    'PC1>SW1 Neighbor Solicitation',
    'SW1>PC2 Neighbor Solicitation', 'SW1>PC3 Neighbor Solicitation',
    'PC2>SW1 Neighbor Advertisement', 'SW1>PC1 Neighbor Advertisement',
    'PC1>SW1 ICMPv6 Echo Request', 'SW1>PC2 ICMPv6 Echo Request',
    'PC2>SW1 ICMPv6 Echo Reply', 'SW1>PC1 ICMPv6 Echo Reply',
  ]);
  const solicitation = events.find((e) => e.topic === Topics.PACKET_SEND).packet;
  assert.equal(solicitation.cast, 'multicast');
  assert.equal(solicitation.eth.dst, '33:33:FF:00:00:11');
  assert.equal(solicitation.eth.type, 'IPv6');
  // PC3 reçoit la trame (le switch l'inonde) mais ne l'accepte pas.
  const atPc3 = events.find((e) => e.topic === Topics.PACKET_RECEIVE && e.device === 'pc3');
  assert.equal(atPc3.accepted, false);
  assert.ok(noteKeys(events).includes('ipv6.success'));
  assert.equal(sim.device('pc1').neighbours.get('2001:db8:6::11'), '02:00:00:00:06:11');
});

test('IPv6 : au second ping, le cache de voisins évite la sollicitation', { skip }, async () => {
  const { sim, events } = await play('ipv6');
  const lines = sends(events, sim);
  assert.equal(lines.filter((line) => line.includes('Neighbor Solicitation')).length, 3, 'une seule sollicitation (recopiée sur 3 câbles)');
  assert.equal(lines.filter((line) => line.endsWith('ICMPv6 Echo Request')).length, 4);
  assert.ok(noteKeys(events).includes('ipv6.cacheHit'));
});
