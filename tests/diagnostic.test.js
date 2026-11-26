// Diagnostic du réseau : chaque règle sur un petit réseau cassé exprès, les corrections
// automatiques, et le scénario « diagnostic » réparé de bout en bout (demande du superviseur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import { applyFix, describeFix, diagnose, freeAddress } from '../src/sim/diagnostic.js';
import { validateScenario } from '../src/sim/scenario.js';
import { loadSim, missingFor, readScenario } from './helpers.js';

const skip = missingFor('diagnostic');
const rules = (scenario, options) => diagnose(scenario, options).findings.map((f) => f.id.split(':')[0]);

/** Petit réseau sain : deux PC, un switch, un routeur, un second réseau derrière. */
function lan() {
  return {
    format: 1, id: 'test', title: { fr: 't', en: 't' }, summary: { fr: 's', en: 's' }, protocols: ['arp', 'icmp'],
    devices: [
      { id: 'pc1', type: 'host', name: 'PC1', position: [0, 0, 0], interfaces: [{ name: 'eth0', mac: '02:00:00:00:00:01', ip: '192.168.1.10', prefix: 24 }], gateway: '192.168.1.1' },
      { id: 'pc2', type: 'host', name: 'PC2', position: [0, 0, 2], interfaces: [{ name: 'eth0', mac: '02:00:00:00:00:02', ip: '192.168.1.11', prefix: 24 }], gateway: '192.168.1.1' },
      { id: 'sw1', type: 'switch', name: 'SW1', position: [2, 0, 0] },
      { id: 'r1', type: 'router', name: 'R1', position: [4, 0, 0], interfaces: [
        { name: 'g0/0', mac: '02:00:00:00:00:0A', ip: '192.168.1.1', prefix: 24 },
        { name: 'g0/1', mac: '02:00:00:00:00:0B', ip: '10.0.0.1', prefix: 24 }] },
      { id: 'srv', type: 'server', name: 'SRV', position: [6, 0, 0], interfaces: [{ name: 'eth0', mac: '02:00:00:00:00:03', ip: '10.0.0.5', prefix: 24 }], gateway: '10.0.0.1' },
    ],
    links: [
      { id: 'l1', a: 'pc1:eth0', b: 'sw1:p1' }, { id: 'l2', a: 'pc2:eth0', b: 'sw1:p2' },
      { id: 'l3', a: 'sw1:p3', b: 'r1:g0/0' }, { id: 'l4', a: 'r1:g0/1', b: 'srv:eth0' },
    ],
    steps: [{ action: 'ping', from: 'pc1', to: 'srv' }],
  };
}

test('diagnostic : un réseau correct est déclaré sain', () => {
  const report = diagnose(lan());
  assert.equal(report.healthy, true);
  assert.deepEqual(rules(lan()), ['healthy']);
  for (const name of ['ping', 'routage', 'tcp', 'udp', 'dns', 'http', 'topologie-demo']) {
    assert.equal(diagnose(readScenario(name)).healthy, true, name);
  }
});

test('diagnostic : adresses en double, poste sans adresse, deux réseaux sur un switch', () => {
  const s = lan();
  s.devices[1].interfaces[0].ip = '192.168.1.10';
  s.devices[1].interfaces[0].mac = '02:00:00:00:00:01';
  let report = diagnose(s);
  assert.deepEqual(report.findings.slice(0, 2).map((f) => f.severity), ['error', 'error']);
  assert.ok(rules(s).includes('dupIp') && rules(s).includes('dupMac'));
  const dup = report.findings.find((f) => f.id.startsWith('dupIp'));
  assert.deepEqual(dup.devices, ['pc1', 'pc2']);
  assert.equal(dup.fix.ip, '192.168.1.11'); // PC2 a quitté .11 pour .10 : .11 est de nouveau libre
  assert.equal(freeAddress(lan(), '192.168.1.0', 24), '192.168.1.12');

  const noIp = lan();
  delete noIp.devices[1].interfaces[0].ip;
  report = diagnose(noIp);
  const missing = report.findings.find((f) => f.id.startsWith('noIp'));
  assert.equal(missing.fix.op, 'setIp');
  assert.deepEqual(validateScenario(applyFix(noIp, missing.fix)).errors, []);

  const mixed = lan();
  mixed.devices[1].interfaces[0].ip = '192.168.2.11';
  assert.ok(rules(mixed).includes('mixedSubnets'));
  const fixed = applyFix(mixed, diagnose(mixed).findings.find((f) => f.id.startsWith('mixedSubnets')).fix);
  assert.equal(fixed.devices[1].interfaces[0].ip.startsWith('192.168.1.'), true);
});

test('diagnostic : passerelle hors réseau, qui n\'est pas un routeur, ou absente', () => {
  const outside = lan();
  outside.devices[0].gateway = '192.168.9.1';
  const gw = diagnose(outside).findings.find((f) => f.id.startsWith('gwOutside'));
  assert.deepEqual(gw.fix, { op: 'setGateway', device: 'pc1', gateway: '192.168.1.1' });

  const notRouter = lan();
  notRouter.devices[0].gateway = '192.168.1.11';
  const nr = diagnose(notRouter).findings.find((f) => f.id.startsWith('gwNotRouter'));
  assert.ok(nr.cause.fr.includes('PC2') && nr.cause.en.includes('not a router'));

  const none = lan();
  delete none.devices[0].gateway;
  const missing = diagnose(none).findings.find((f) => f.id.startsWith('gwMissing'));
  assert.equal(missing.severity, 'warning');
  assert.ok(missing.cause.fr.includes('10.0.0.0/24'));
});

test('diagnostic : route manquante trouvée et corrigée par le bon voisin', () => {
  const s = readScenario('routage');
  s.devices.find((d) => d.id === 'r2').routes = [];
  const finding = diagnose(s).findings.find((f) => f.id.startsWith('noRoute'));
  assert.equal(finding.severity, 'error');
  assert.equal(finding.fix.route.via, '10.0.12.1');
  assert.equal(diagnose(applyFix(s, finding.fix)).healthy, true);
  // Prochain saut injoignable
  const bad = readScenario('routage');
  bad.devices.find((d) => d.id === 'r2').routes[0].via = '172.16.0.1';
  assert.ok(rules(bad).includes('badVia'));
});

test('diagnostic : câblage — équipement isolé, boucle, câble trop long, port absent', () => {
  const s = lan();
  s.devices.push({ id: 'sw2', type: 'switch', name: 'SW2', position: [2, 0, 4] });
  s.devices.push({ id: 'pc9', type: 'host', name: 'PC9', position: [9, 0, 9], interfaces: [{ name: 'eth0', mac: '02:00:00:00:00:09', ip: '192.168.1.99', prefix: 24 }] });
  s.links.push({ id: 'l5', a: 'sw1:p4', b: 'sw2:p1' }, { id: 'l6', a: 'sw1:p5', b: 'sw2:p2' });
  s.links[0].length = 140;
  s.devices[2].model = 'sw-8g';
  s.links[2].b = 'r1:g0/0';
  s.links[1].b = 'sw1:p12';
  const report = diagnose(s);
  const ids = report.findings.map((f) => f.id);
  assert.ok(ids.includes('isolated:pc9'));
  const loop = report.findings.find((f) => f.id.startsWith('loop'));
  assert.deepEqual(loop.fix, { op: 'removeLink', link: 'l6' });
  assert.ok(ids.includes('cableReach:l1'));
  const port = report.findings.find((f) => f.id.startsWith('unknownPort'));
  assert.equal(port.fix.to, 'p2'); // p1, p3, p4, p5 sont pris ; p2 a été libéré
  const after = applyFix(applyFix(s, loop.fix), port.fix);
  assert.equal(after.links.length, s.links.length - 1);
  assert.ok(after.links.some((l) => l.b === 'sw1:p2'));
  assert.equal(s.links.length, 6, 'le scénario d\'origine n\'est jamais modifié');
});

test('diagnostic : performances — câble ou carte qui bride, lien saturé, pertes', () => {
  const report = diagnose(readScenario('debit'));
  const cable = report.findings.find((f) => f.id.startsWith('cableLimit'));
  assert.deepEqual(cable.fix, { op: 'setCable', link: 'l3', cable: 'cat6' });
  const card = report.findings.find((f) => f.id.startsWith('cardLimit'));
  assert.equal(card.fix.model, 'pc-std');
  assert.ok(report.findings.some((f) => f.id.startsWith('serverBottleneck')));
  assert.equal(describeFix(cable.fix).fr, 'Câble Cat 6');
  const live = diagnose(lan(), { traffic: { links: { l4: { max: 0.93, lost: 2 } }, ports: { 'r1:g0/1': { maxQueue: 5 } } } });
  const ids = live.findings.map((f) => f.id);
  assert.ok(ids.includes('saturated:l4') && ids.includes('losses:l4'));
  assert.ok(live.findings.find((f) => f.id === 'saturated:l4').cause.fr.includes('93 %'));
});

test('diagnostic : DNS introuvable, avec ou sans serveur DNS dans le réseau', () => {
  const s = readScenario('dns');
  const pc = s.devices.find((d) => d.dns);
  pc.dns = '192.168.1.99';
  const finding = diagnose(s).findings.find((f) => f.id.startsWith('dnsMissing'));
  assert.ok(finding.fix.dns && finding.fix.dns !== '192.168.1.99');
  const none = lan();
  none.devices[0].dns = '10.0.0.53';
  const lonely = diagnose(none).findings.find((f) => f.id.startsWith('dnsMissing'));
  assert.equal(lonely.fix.dns, null);
  assert.equal(applyFix(none, lonely.fix).devices[0].dns, undefined);
});

test('diagnostic : le scénario cassé échoue, puis passe une fois tout corrigé', { skip }, async () => {
  const broken = readScenario('diagnostic');
  const before = diagnose(broken);
  assert.deepEqual(before.counts, { error: 4, warning: 1, info: 0 });
  let scenario = broken;
  for (let i = 0; i < 10; i++) {
    const next = diagnose(scenario).findings.find((f) => f.fix);
    if (!next) break;
    scenario = applyFix(scenario, next.fix);
  }
  assert.equal(diagnose(scenario).healthy, true);
  const replies = async (edit) => {
    const { sim, events } = await loadSim('diagnostic', edit);
    sim.engine.runToEnd();
    return events.filter((e) => e.topic === Topics.PACKET_RECEIVE && e.accepted && /Echo Reply/.test(e.packet.label) && ['pc1', 'pc3', 'pc4'].includes(e.device)).length;
  };
  assert.equal(await replies(), 1); // seul PC4 → SRV1 (même réseau) réussit
  assert.equal(await replies(() => scenario), 3);
});
