// Débit et bande passante : catalogue, temps d'émission, files d'attente, pertes et
// transferts TCP découpés (demande du superviseur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.mjs';
import { cableSpeed, formatRate, formatSpeed, linkSpeed, MODELS, portNames, specsOf } from '../src/sim/catalog.mjs';
import { frameBytes, rateOf, transmitTime, TrafficMeter, loadLevel } from '../src/sim/traffic.mjs';
import { validateScenario } from '../src/sim/scenario.mjs';
import { FRAME_GAP, MSS } from '../src/sim/traffic.mjs';
import { loadSim, play, noteKeys, readScenario } from './helpers.mjs';

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
/** Segments de données émis par un poste (on ignore les recopies du switch). */
const dataSegments = (events, from) => events
  .filter((e) => e.topic === Topics.PACKET_SEND && e.from === from && e.packet.tcp && e.packet.tcp.len > 0);

test('catalogue : ports, vitesses et caractéristiques calculées', () => {
  assert.deepEqual(portNames(MODELS['sw-8g']), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  assert.equal(portNames(MODELS['sw-24g']).at(-1), 'u2');
  const specs = specsOf(MODELS['sw-8g']);
  assert.equal(specs.switchingCapacity, 16000); // 8 × 1 Gb/s × 2
  assert.ok(Math.abs(specs.forwardingRate - 11.9) < 0.01); // 8 Gb/s / (84 octets × 8)
  assert.equal(formatSpeed(100), '100 Mb/s');
  assert.equal(formatSpeed(10000), '10 Gb/s');
  assert.equal(formatRate(86_200_000), '86.2 Mb/s');
  assert.equal(formatRate(0), '0 b/s');
});

test('catalogue : un lien prend la vitesse la plus faible (carte ou câble)', () => {
  const pc = { type: 'host', model: 'pc-std' };
  const old = { type: 'host', model: 'pc-fe' };
  const sw = { type: 'switch', model: 'sw-24g' };
  assert.deepEqual(linkSpeed(pc, 'eth0', sw, 'p1', 'cat6', 10), { speed: 1000, speedA: 1000, speedB: 1000, cableSpeed: 10000, limitedBy: null });
  assert.equal(linkSpeed(old, 'eth0', sw, 'p1').limitedBy, 'a');
  assert.equal(linkSpeed(sw, 'p1', old, 'eth0').limitedBy, 'b');
  const cat5 = linkSpeed(pc, 'eth0', sw, 'p1', 'cat5');
  assert.deepEqual([cat5.speed, cat5.limitedBy], [100, 'cable']);
  // Le Cat 6 ne tient 10 Gb/s que sur 55 m.
  assert.equal(cableSpeed('cat6', 30), 10000);
  assert.equal(cableSpeed('cat6', 80), 1000);
  // Une interface peut imposer sa vitesse.
  const forced = { type: 'host', interfaces: [{ name: 'eth0', speed: 10 }] };
  assert.equal(linkSpeed(forced, 'eth0', sw, 'u1').speed, 10);
});

test('trafic : taille des trames et temps d\'émission au ralenti', () => {
  assert.equal(frameBytes({ arp: {} }), 64); // 14 + 4 + 28 = 46 → complété à 64
  assert.equal(frameBytes({ ip: {}, tcp: { len: MSS } }), 1518); // trame pleine
  // 1 518 octets à 1 Gb/s = 12,144 µs réels = 121,44 ms à l'écran ; dix fois plus à 100 Mb/s.
  assert.ok(Math.abs(transmitTime(1518, 1000) - 121.44) < 1e-9);
  assert.ok(Math.abs(transmitTime(1518, 100) - 1214.4) < 1e-9);
  // 1 250 octets en 100 ms simulées = 10 µs réels → 1 Gb/s.
  assert.ok(Math.abs(rateOf(1250, 100) - 1e9) < 1);
});

test('trafic : taux d\'utilisation et débit sur la fenêtre de mesure', () => {
  const meter = new TrafficMeter();
  meter.queued('a:eth0');
  meter.sent('a:eth0', 'l1', 'ab', 1000, 0, 2000); // occupe le lien pendant 2 s
  const load = meter.linkLoad('l1', 4000);
  assert.equal(load.ab, 0.5);
  assert.equal(load.ba, 0);
  assert.equal(loadLevel(load.max), 'busy');
  assert.equal(loadLevel(0.9), 'saturated');
  assert.equal(meter.port('a:eth0').queue, 0);
  assert.equal(meter.portRates('a:eth0', 4000).tx, rateOf(1000, 4000));
});

test('scénario : modèles, câbles, vitesses et étapes groupées sont vérifiés', () => {
  assert.deepEqual(validateScenario(readScenario('debit')).errors, []);
  const broken = readScenario('debit');
  broken.devices[0].model = 'sw-8g'; // un switch sur un PC
  broken.links[0].cable = 'cat9';
  broken.devices[1].interfaces[0].speed = 250;
  broken.steps[3].steps = [];
  broken.steps[0].lose = [-1];
  const errors = validateScenario(broken).errors.join('\n');
  for (const part of ['n\'est pas un modèle de host', 'cat9', 'speed', 'steps[3].steps', 'lose']) assert.ok(errors.includes(part), part);
});

test('débit : un lien à 100 Mb/s émet chaque grande trame dix fois plus lentement', async () => {
  const fast = await play('debit', only(0));
  const slow = await play('debit', only(1));
  const big = (events, from) => dataSegments(events, from).find((e) => e.bytes === 1518);
  assert.equal(big(fast.events, 'pc1').sending, 121);
  assert.equal(big(slow.events, 'pc2').sending, 1214);
  assert.equal(fast.sim.link('l2').speed, 100);
  assert.equal(fast.sim.link('l3').limitedBy, 'cable');
  // Les deux transferts se terminent, le second bien plus tard.
  const done = (events) => events.flatMap((e) => e.notes || []).find((n) => n.key === 'tcp.bulkDone');
  assert.ok(Number(done(fast.events).params.time) < Number(done(slow.events).params.time));
});

test('débit : la fenêtre glissante laisse partir plusieurs segments sans attendre', async () => {
  const { events } = await play('debit', only(0));
  const sends = dataSegments(events, 'pc1');
  assert.equal(sends.length, 10);
  // Fenêtre de 10 : les 10 segments sortent à la file, sans attendre aucun ACK. Le port de
  // PC1 les émet l'un après l'autre : chacun part dès que le précédent a fini (+ l'écart d'affichage).
  for (let i = 1; i < sends.length; i++) assert.equal(sends[i].time, sends[i - 1].time + sends[i - 1].sending + FRAME_GAP);
});

test('débit : perte → ACK dupliqués → retransmission rapide, puis délai RTO', async () => {
  const { events, sim } = await play('debit', only(2));
  const lost = events.filter((e) => e.topic === Topics.PACKET_DROP && e.onLink);
  assert.deepEqual(lost.map((e) => e.packet.label), ['TCP 3/10', 'TCP 10/10']);
  const keys = noteKeys(events);
  for (const key of ['tcp.outOfOrder', 'tcp.dupAck', 'tcp.fastRetransmit', 'tcp.filled', 'tcp.timeout', 'tcp.bulkDone']) {
    assert.ok(keys.includes(key), key);
  }
  // La retransmission rapide arrive avant le délai : le 3e ACK dupliqué la déclenche.
  const at = (key) => events.find((e) => (e.notes || []).some((n) => n.key === key)).time;
  assert.ok(at('tcp.fastRetransmit') < at('tcp.timeout'));
  const done = events.flatMap((e) => e.notes || []).find((n) => n.key === 'tcp.bulkDone');
  assert.equal(done.params.retransmits, 2);
  assert.equal(sim.state, 'finished');
  // Tout est arrivé : le serveur attend l'octet qui suit les 14 600 (+ 1 pour le FIN de fermeture).
  const server = [...sim.device('srv1').tcpConns.values()].at(-1);
  assert.equal(server.rcv - server.rcvStart, 14600 + 1);
});

test('débit : trois envois simultanés partagent le lien du serveur', async () => {
  const { sim, events } = await loadSim('debit', only(3));
  sim.execute('play');
  let peak = 0;
  let queue = 0;
  for (let i = 0; i < 400 && sim.state !== 'finished'; i++) {
    sim.tick(250);
    const traffic = sim.traffic();
    peak = Math.max(peak, traffic.links.l4.max);
    queue = Math.max(queue, traffic.ports['sw1:p4'] ? traffic.ports['sw1:p4'].maxQueue : 0);
  }
  assert.equal(sim.state, 'finished');
  assert.ok(peak > 0.5, `charge maximale du lien serveur : ${peak}`);
  assert.ok(queue >= 2, 'une file d\'attente se forme sur le port du switch vers le serveur');
  const done = events.flatMap((e) => e.notes || []).filter((n) => n.key === 'tcp.bulkDone');
  assert.equal(done.length, 3);
  // Après réinitialisation, plus aucun trafic.
  sim.execute('reset');
  assert.equal(sim.traffic().links.l4.max, 0);
});

test('catalogue : chaque câble a sa description (fr/en) et un résumé chiffré cohérent', async () => {
  const { CABLES, cableSummary, formatSpeed } = await import('../src/sim/catalog.mjs');
  for (const [id, cable] of Object.entries(CABLES)) {
    assert.ok(cable.description && cable.description.fr && cable.description.en, `${id} : description manquante`);
    const summary = cableSummary(id);
    assert.ok(summary.fr.includes(formatSpeed(cable.max)) && summary.fr.includes(`${cable.reach} m`), `${id} : ${summary.fr}`);
    assert.ok(summary.en.startsWith('up to'), `${id} : ${summary.en}`);
  }
  assert.match(cableSummary('cat6').fr, /1 Gb\/s au-delà de 55 m/, 'Cat 6 : 1 Gb/s au-delà de 55 m');
});
