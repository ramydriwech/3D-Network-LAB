import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import dns from '../src/sim/protocols/dns.js';
import { loadSim, play, sends, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « dns » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('dns');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
const dnsPackets = (events) => events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.dns).map((e) => e.packet);

test('DNS : question et réponse en UDP sur le port 53', { skip }, async () => {
  const { sim, events } = await play('dns', only(0));
  const lines = sends(events, sim).filter((line) => line.includes('DNS '));
  assert.deepEqual(lines, ['PC1>SW1 DNS Query', 'SW1>DNS1 DNS Query', 'DNS1>SW1 DNS Response', 'SW1>PC1 DNS Response']);
  const [query, , response] = dnsPackets(events);
  assert.equal(query.protocol, 'dns');
  assert.equal(query.udp.dstPort, 53);
  assert.equal(query.ip.dst, '192.168.1.53');
  assert.deepEqual(query.dns, { id: 1, qr: 'query', name: 'www.supcom.tn', type: 'A' });
  assert.equal(response.udp.srcPort, 53);
  assert.equal(response.udp.dstPort, query.udp.srcPort, 'la réponse revient sur le port d\'où la question est partie');
  assert.equal(response.dns.id, query.dns.id);
  assert.equal(response.dns.answer, '192.168.1.80');
  assert.equal(sim.device('pc1').dnsCache.get('www.supcom.tn'), '192.168.1.80');
  assert.ok(noteKeys(events).includes('dns.resolved'));
});

test('DNS : nom inconnu, réponse NXDOMAIN', { skip }, async () => {
  const { sim, events } = await play('dns', only(1));
  const response = dnsPackets(events).find((packet) => packet.dns.qr === 'response');
  assert.equal(response.dns.rcode, 'NXDOMAIN');
  assert.equal(response.dns.answer, null);
  assert.equal(sim.device('pc1').dnsCache.size, 0);
  assert.ok(noteKeys(events).includes('dns.failed'));
});

test('DNS : la seconde demande est servie par le cache, sans trafic', { skip }, async () => {
  const { sim, events } = await play('dns', (scenario) => ({ ...scenario, steps: [scenario.steps[0], scenario.steps[2]] }));
  assert.equal(dnsPackets(events).filter((packet) => packet.dns.qr === 'query' ).length, 2, 'une seule question, vue sur deux câbles');
  assert.ok(noteKeys(events).includes('dns.cacheHit'));
  assert.equal(sim.state, 'finished');
});

test('DNS : résolution par programme, client sans serveur configuré, inspecteur', { skip }, async () => {
  const { sim, events } = await loadSim('dns', (scenario) => ({ ...scenario, steps: [] }));
  const answers = [];
  dns.resolve(sim.device('pc1'), 'mail.supcom.tn', (ip) => answers.push(ip));
  dns.resolve(sim.device('web1'), 'www.supcom.tn', (ip) => answers.push(ip)); // WEB1 n'a pas de serveur DNS
  sim.engine.runToEnd();
  assert.deepEqual(answers, [null, '192.168.1.25']);
  assert.ok(noteKeys(events).includes('dns.noServer'));
  const response = dnsPackets(events).find((packet) => packet.dns.qr === 'response');
  assert.equal(dns.describe(response).length, 5);
  assert.deepEqual(dns.describe({}), []);
});
