import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import http, { parseUrl } from '../src/sim/protocols/http.js';
import { play, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « http » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('http');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
/** Messages émis par les extrémités, dans l'ordre (sans ARP ni recopies du switch). */
const labels = (events) => events
  .filter((e) => e.topic === Topics.PACKET_SEND && e.from !== 'sw1' && e.packet.protocol !== 'arp')
  .map((e) => `${e.from} ${e.packet.label}`);

test('HTTP : découpage d\'une URL', () => {
  assert.deepEqual(parseUrl('http://www.supcom.tn/'), { host: 'www.supcom.tn', port: 80, path: '/' });
  assert.deepEqual(parseUrl('http://192.168.1.80:8080/a/b'), { host: '192.168.1.80', port: 8080, path: '/a/b' });
  assert.deepEqual(parseUrl('www.supcom.tn'), { host: 'www.supcom.tn', port: 80, path: '/' });
});

test('HTTP : DNS, puis TCP, puis la requête et la réponse, puis la fermeture', { skip }, async () => {
  const { sim, events } = await play('http', only(0));
  assert.deepEqual(labels(events), [
    'pc1 DNS Query', 'dns1 DNS Response',
    'pc1 TCP SYN', 'web1 TCP SYN,ACK', 'pc1 TCP ACK',
    'pc1 HTTP GET /', 'web1 HTTP 200 OK',
    'pc1 TCP FIN,ACK', 'web1 TCP ACK', 'web1 TCP FIN,ACK', 'pc1 TCP ACK',
  ]);
  const packets = events.filter((e) => e.topic === Topics.PACKET_SEND && e.packet.http && e.from !== 'sw1').map((e) => e.packet);
  const [request, response] = packets;
  assert.equal(request.protocol, 'http');
  assert.deepEqual(request.http, { type: 'request', method: 'GET', path: '/', version: 'HTTP/1.1', host: 'www.supcom.tn' });
  assert.equal(request.tcp.dstPort, 80);
  assert.equal(request.ip.dst, '192.168.1.80', 'l\'adresse vient de la réponse DNS');
  assert.equal(response.http.status, 200);
  assert.equal(response.http.contentLength, response.data.length);
  assert.equal(response.tcp.ack, request.tcp.seq + request.tcp.len, 'la réponse acquitte la requête');
  assert.equal(sim.device('pc1').httpLast.title, 'SUP\'COM');
  assert.ok(noteKeys(events).includes('http.rendered'));
});

test('HTTP : page inconnue, réponse 404 ; le cache DNS évite une nouvelle question', { skip }, async () => {
  const { sim, events } = await play('http');
  const all = labels(events);
  assert.equal(all.filter((line) => line === 'pc1 DNS Query').length, 1);
  assert.ok(all.includes('pc1 HTTP GET /inconnu'));
  assert.ok(all.includes('web1 HTTP 404 Not Found'));
  assert.equal(sim.device('pc1').httpLast.status, 404);
  assert.ok(noteKeys(events).includes('dns.cacheHit'));
});

test('HTTP : URL avec adresse IP (pas de DNS) et nom introuvable', { skip }, async () => {
  const direct = await play('http', (scenario) => ({ ...scenario, steps: [{ action: 'http', from: 'pc1', url: 'http://192.168.1.80/' }] }));
  assert.ok(!labels(direct.events).includes('pc1 DNS Query'));
  assert.equal(direct.sim.device('pc1').httpLast.status, 200);

  const unknown = await play('http', (scenario) => ({ ...scenario, steps: [{ action: 'http', from: 'pc1', url: 'http://nulle-part.tn/' }] }));
  assert.ok(noteKeys(unknown.events).includes('http.dnsFailed'));
  assert.ok(!labels(unknown.events).includes('pc1 TCP SYN'));
});

test('HTTP : lignes de l\'inspecteur', () => {
  const request = http.describe({ http: { type: 'request', method: 'GET', path: '/', version: 'HTTP/1.1', host: 'h' } });
  assert.equal(request[0].value, 'GET / HTTP/1.1');
  const response = http.describe({ http: { type: 'response', version: 'HTTP/1.1', status: 200, reason: 'OK', contentType: 'text/html', contentLength: 5 } });
  assert.equal(response[0].value, 'HTTP/1.1 200 OK');
  assert.deepEqual(http.describe({}), []);
});
