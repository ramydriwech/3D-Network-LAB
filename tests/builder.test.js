// Éditeur de topologie : opérations pures sur un brouillon (demande du superviseur).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/sim/builder.js';
import { diagnose } from '../src/sim/diagnostic.js';
import { validateScenario } from '../src/sim/scenario.js';
import { createSimulation, Topics } from '../simulation.js';
import { readScenario } from './helpers.js';

/** PC1, PC2 — SW1 — R1 — R2 — SW2 — SRV1, sans aucune adresse. */
function twoLans() {
  let d = B.emptyDraft();
  const add = (type, options) => { const r = B.addDevice(d, type, options); d = r.draft; return r.id; };
  const ids = { pc1: add('host'), pc2: add('host'), sw1: add('switch'), r1: add('router'), r2: add('router'), sw2: add('switch'), srv: add('server') };
  for (const [a, b] of [['pc1', 'sw1'], ['pc2', 'sw1'], ['sw1', 'r1'], ['r1', 'r2'], ['r2', 'sw2'], ['srv', 'sw2']]) d = B.addLink(d, ids[a], ids[b]).draft;
  return { d, ids };
}

test('éditeur : ajouter des équipements (identifiants, MAC, ports, places libres)', () => {
  const empty = B.emptyDraft();
  assert.deepEqual(validateScenario(empty).errors, [], 'un brouillon vide est un scénario valide');
  const { draft, id } = B.addDevice(empty, 'router', { model: 'rt-4g' });
  assert.equal(id, 'r1');
  assert.equal(empty.devices.length, 0, 'l\'original n\'est pas modifié');
  const router = draft.devices[0];
  assert.deepEqual(router.interfaces.map((i) => i.name), ['g0/0', 'g0/1', 'g0/2', 'g0/3']);
  assert.equal(new Set(router.interfaces.map((i) => i.mac)).size, 4);
  const next = B.addDevice(draft, 'host').draft;
  const [a, b] = next.devices.map((def) => def.position);
  assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) >= 3.5, 'deux équipements ne se superposent pas');
  assert.throws(() => B.addDevice(draft, 'host', { model: 'sw-8g' }), B.BuildError);
});

test('éditeur : câbles sur le premier port libre, refus clairs', () => {
  const { d, ids } = twoLans();
  assert.deepEqual(d.links.map((l) => l.b), ['sw1:p1', 'sw1:p2', 'r1:g0/0', 'r2:g0/0', 'sw2:p1', 'sw2:p2']);
  assert.deepEqual(B.freePorts(d, ids.r1), []);
  let error = null;
  try { B.addLink(d, ids.r1, ids.sw2); } catch (e) { error = e; }
  assert.ok(error instanceof B.BuildError);
  assert.match(error.text.en, /R1 has no free port/);
  assert.throws(() => B.addLink(d, ids.pc1, ids.srv), /switch/);
  assert.throws(() => B.addLink(d, ids.pc1, ids.pc1), B.BuildError);
  assert.deepEqual(validateScenario(d).errors, []);
});

test('éditeur : adressage automatique → réseau sain qui fonctionne vraiment', async () => {
  const { d, ids } = twoLans();
  const { draft, changes } = B.autoAddress(d);
  assert.ok(changes >= 10);
  const ip = (id, i = 0) => draft.devices.find((x) => x.id === id).interfaces[i].ip;
  assert.equal(ip(ids.r1), '192.168.1.1');
  assert.equal(ip(ids.pc1), '192.168.1.10');
  assert.equal(ip(ids.r1, 1), '10.0.0.1'); // lien de transit /30
  assert.equal(ip(ids.r2), '10.0.0.2');
  assert.equal(draft.devices.find((x) => x.id === ids.pc1).gateway, '192.168.1.1');
  assert.equal(diagnose(draft).healthy, true);
  // Une seconde fois : rien à ajouter.
  assert.equal(B.autoAddress(draft).changes, 0);
  // Et le ping traverse vraiment les deux routeurs.
  const sim = createSimulation();
  const replies = [];
  sim.on(Topics.PACKET_RECEIVE, (e) => { if (e.accepted && e.device === ids.pc1 && /Echo Reply/.test(e.packet.label)) replies.push(e); });
  await sim.loadScenario(B.addStep(draft, { action: 'ping', from: ids.pc1, to: ids.srv }));
  sim.engine.runToEnd();
  assert.equal(replies.length, 1);
});

test('éditeur : suggestions d\'adresse, de passerelle et rôles des serveurs', () => {
  const { d, ids } = twoLans();
  let draft = B.setAddress(d, ids.r1, 'g0/0', '172.16.5.1', 24);
  assert.deepEqual(B.suggestAddress(draft, ids.pc1, 'eth0'), { ip: '172.16.5.10', prefix: 24 });
  draft = B.setAddress(draft, ids.pc1, 'eth0', '172.16.5.10', 24);
  assert.equal(B.suggestGateway(draft, ids.pc1), '172.16.5.1');
  assert.deepEqual(B.suggestAddress(draft, ids.srv, 'eth0'), { ip: '192.168.1.10', prefix: 24 }, 'réseau sans adresse : un réseau neuf');
  assert.throws(() => B.setAddress(draft, ids.pc2, 'eth0', '172.16.5.255', 24), /diffusion|broadcast/);
  assert.throws(() => B.setService(draft, ids.srv, 'dns', true), B.BuildError, 'un serveur sans adresse ne peut pas rendre de service');
  draft = B.autoAddress(draft).draft;
  draft = B.setService(draft, ids.srv, 'dns', true);
  draft = B.setService(draft, ids.srv, 'dhcp', true);
  const srv = draft.devices.find((x) => x.id === ids.srv);
  assert.equal(srv.services.dns.records['pc1.lan'], '172.16.5.10');
  assert.equal(srv.services.dhcp.gateway, srv.gateway);
  assert.equal(B.setService(draft, ids.srv, 'dns', false).devices.find((x) => x.id === ids.srv).services.dns, undefined);
});

test('éditeur : modèle, suppression, routes, import/export, historique', () => {
  const { d, ids } = twoLans();
  // Un switch 8 ports ne peut pas devenir un modèle sans port p2 si un câble y est branché : ici tous ont p1..p8.
  const bigger = B.updateDevice(d, ids.r1, { model: 'rt-4g' });
  assert.equal(bigger.devices.find((x) => x.id === ids.r1).interfaces.length, 4);
  assert.throws(() => B.updateDevice(bigger, ids.r1, { model: 'sw-8g' }), B.BuildError);
  const removed = B.removeDevice(B.addStep(d, { action: 'ping', from: ids.pc1, to: ids.pc2 }), ids.pc2);
  assert.equal(removed.links.some((l) => l.a.startsWith(ids.pc2)), false);
  assert.equal(removed.steps.length, 0, 'l\'étape qui citait PC2 disparaît');
  const routed = B.setRoutes(d, ids.r1, [{ network: '192.168.7.99', prefix: 24, via: '10.0.0.2' }]);
  assert.deepEqual(routed.devices.find((x) => x.id === ids.r1).routes, [{ network: '192.168.7.0', prefix: 24, via: '10.0.0.2' }]);
  assert.deepEqual(B.importJson(B.exportJson(d)), d);
  assert.throws(() => B.importJson('{ pas du json'), /JSON/);
  assert.throws(() => B.importJson('{"format": 1}'), /invalide|Invalid/);
  const scenario = B.draftFrom(readScenario('ping'));
  assert.equal(scenario.id, 'ping-modifie');
  assert.ok(scenario.protocols.includes('http'));

  const history = new B.History(d);
  const one = B.moveDevice(d, ids.pc1, [3.14, 9, -2.06]);
  history.push(one);
  assert.deepEqual(one.devices[0].position, [3.1, 0, -2.1]);
  assert.equal(history.undo(), d);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), one);
  history.push(B.removeLink(one, 'l1'));
  assert.equal(history.canRedo, false, 'une nouvelle modification efface ce qui pouvait être rétabli');
});
