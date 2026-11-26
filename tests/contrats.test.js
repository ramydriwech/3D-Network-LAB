// Premiers tests automatiques (S1) : ils protègent les contrats communs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Topics, PROTOCOL_IDS, createPacket, validatePacket, validateProtocol, formatText, castOf } from '../src/sim/events.js';
import { validateScenario, parseEndpoint } from '../src/sim/scenario.js';
import { isIp, isMac, networkOf, broadcastOf, inNetwork, maskToString } from '../src/sim/addr.js';
import { COMMAND_NAMES, createCommands } from '../src/sim/commands.js';
import { createMockSimulation } from '../src/sim/mockEngine.js';
import { createSimulation } from '../simulation.js';

const demo = () => JSON.parse(readFileSync(new URL('../scenarios/topologie-demo.json', import.meta.url), 'utf8'));

test('adresses : validation et calculs de sous-réseau', () => {
  assert.ok(isIp('192.168.1.10'));
  assert.ok(!isIp('192.168.1.256'));
  assert.ok(isMac('02:00:00:00:01:10'));
  assert.ok(!isMac('02:00:00:00:01'));
  assert.equal(networkOf('192.168.1.77', 24), '192.168.1.0');
  assert.equal(broadcastOf('192.168.1.77', 24), '192.168.1.255');
  assert.equal(maskToString(26), '255.255.255.192');
  assert.ok(inNetwork('10.0.0.130', '10.0.0.128', 25));
  assert.ok(!inNetwork('10.0.0.5', '10.0.0.128', 25));
});

test('format de scénario : la topologie de démonstration est valide', () => {
  const { ok, errors } = validateScenario(demo());
  assert.deepEqual(errors, []);
  assert.ok(ok);
  assert.deepEqual(parseEndpoint('pc1:eth0'), { device: 'pc1', iface: 'eth0' });
});

test('format de scénario : les erreurs sont signalées avec leur emplacement', () => {
  const broken = demo();
  broken.devices[0].interfaces[0].mac = 'pas-une-mac';
  broken.devices[1].interfaces[0].ip = '300.1.1.1';
  broken.links[0].a = 'inconnu:eth0';
  broken.links.push({ id: 'l1', a: 'pc2:eth0', b: 'sw1:p9' });
  delete broken.title;
  const { ok, errors } = validateScenario(broken);
  assert.equal(ok, false);
  const text = errors.join('\n');
  assert.match(text, /devices\[0\]\.interfaces\[0\]\.mac/);
  assert.match(text, /devices\[1\]\.interfaces\[0\]\.ip/);
  assert.match(text, /équipement « inconnu » inconnu/);
  assert.match(text, /« l1 » en double/);
  assert.match(text, /déjà câblé/);
  assert.match(text, /title/);
});

test('évènements : paquet valide, diffusion détectée, paquet invalide refusé', () => {
  assert.equal(PROTOCOL_IDS.length, 9);
  const packet = createPacket({
    protocol: 'arp', label: 'ARP Request',
    eth: { src: '02:00:00:00:01:10', dst: 'FF:FF:FF:FF:FF:FF', type: 'ARP' },
  }, 'p1');
  assert.equal(packet.cast, 'broadcast');
  assert.equal(packet.flow, 'p1');
  assert.equal(castOf('02:00:00:00:01:11'), 'unicast');
  assert.equal(castOf('33:33:FF:00:00:01'), 'multicast');
  assert.ok(validatePacket({ id: 'x', protocol: 'inconnu', label: 'x' }).length >= 2);
  assert.throws(() => createPacket({ protocol: 'arp' }, 'p2'), /Paquet invalide/);
});

test('contrat des protocoles : fonctions et textes bilingues obligatoires', () => {
  const good = {
    id: 'demo', name: 'Demo', layer: 'réseau', texts: { 'demo.a': { fr: 'a', en: 'a' } },
    install() {}, describe() { return []; },
  };
  assert.deepEqual(validateProtocol(good), []);
  assert.ok(validateProtocol({ id: 'x' }).length > 0);
  assert.match(validateProtocol({ ...good, texts: { k: { fr: 'seul' } } }).join(), /fr et une version en/);
  assert.match(validateProtocol({ ...good, actions: ['go'] }).join(), /start/);
  assert.equal(formatText('{a} vers {b} ({c})', { a: 'PC1', b: 'PC2' }), 'PC1 vers PC2 ({c})');
});

test('commandes : les cinq commandes existent et respectent l\'état', async () => {
  const sim = createSimulation();
  await sim.loadScenario(demo());
  assert.deepEqual(Object.keys(createCommands(sim.engine)).slice(0, 5), [...COMMAND_NAMES]);
  assert.equal(sim.state, 'ready');
  assert.equal(sim.can('pause'), false);
  assert.equal(sim.execute('play'), true);
  assert.equal(sim.state, 'playing');
  assert.equal(sim.can('play'), false);
  assert.equal(sim.execute('pause'), true);
  assert.equal(sim.state, 'paused');
  assert.equal(sim.execute('speed', 2), true);
  assert.equal(sim.speed, 2);
  assert.equal(sim.execute('speed', -1), false);
  sim.execute('reset');
  assert.equal(sim.state, 'ready');
  assert.equal(sim.now, 0);
  assert.throws(() => sim.execute('inconnue'), /Commande inconnue/);
});

test('faux moteur : même interface, évènements rejoués dans l\'ordre', async () => {
  const mock = createMockSimulation();
  const seen = [];
  mock.on(Topics.PACKET_SEND, (event) => seen.push(`send ${event.packet.label} ${event.from}>${event.to}`));
  mock.on(Topics.PACKET_RECEIVE, (event) => seen.push(`recv ${event.device}`));
  await mock.loadScenario(demo());

  assert.equal(mock.execute('pause'), false);
  mock.execute('step', { instant: true }); // un pas = jusqu'à la première réception
  assert.deepEqual(seen, ['send ARP Request pc1>sw1', 'recv sw1']);
  assert.equal(mock.state, 'paused');

  mock.execute('speed', 2);
  mock.execute('play');
  mock.tick(600); // 600 ms réelles à vitesse 2 = 1200 ms simulées
  assert.equal(seen.length, 4);
  mock.tick(10000);
  assert.equal(mock.state, 'finished');
  assert.equal(seen.length, 8);

  mock.execute('reset');
  assert.equal(mock.state, 'ready');
  assert.equal(mock.now, 0);
});
