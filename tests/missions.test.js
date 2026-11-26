// Missions du laboratoire (S7) : chaque mission part d'une situation en panne, n'est pas
// réussie au départ, et le devient quand on fait ce que demande l'énoncé — ici, à la
// console, comme Steve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, evaluateMission, missionScenario, createPingTracker } from '../src/sim/missions.js';
import { createConsole } from '../src/sim/cli.js';
import * as B from '../src/sim/builder.js';
import { createSimulation, Topics } from '../simulation.js';
import { readScenario } from './helpers.js';

const load = async (file) => readScenario(file.replace('.json', ''));

/** Monte une mission : simulation, consoles, suivi des pings, et `ctx` pour l'évaluer. */
async function start(id) {
  const mission = MISSIONS.find((m) => m.id === id);
  const sim = createSimulation();
  await sim.loadScenario(await missionScenario(mission, load));
  const tracker = createPingTracker(sim, Topics);
  const consoles = new Map();
  const api = { scenario: () => sim.scenario, device: (d) => sim.device(d), lang: () => 'en', now: () => sim.now };
  const type = async (deviceId, ...lines) => {
    if (!consoles.has(deviceId)) consoles.set(deviceId, createConsole(api, deviceId));
    const con = consoles.get(deviceId);
    for (const line of lines) {
      const result = con.execute(line);
      assert.ok(!result.error, `${deviceId}: « ${line} » → ${result.lines.join(' ')}`);
      if (result.scenario) await sim.loadScenario(result.scenario);
      if (result.run) { sim.runActions(result.run.steps); sim.engine.runToEnd(); }
    }
  };
  const ctx = {
    get scenario() { return sim.scenario; },
    history: (d) => (consoles.has(d) ? consoles.get(d).history() : []),
    pinged: tracker.pinged,
  };
  return { mission, sim, type, ctx, check: () => evaluateMission(mission, ctx) };
}

test('missions : identifiants uniques, textes bilingues, au moins un objectif et trois indices', () => {
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, MISSIONS.length);
  for (const m of MISSIONS) {
    for (const field of [m.title, m.brief, m.why]) assert.ok(field.fr && field.en, m.id);
    assert.ok(m.tasks.length >= 1 && m.hints.length === 3, m.id);
    for (const task of m.tasks) assert.ok(task.text.fr && task.text.en && typeof task.check === 'function');
  }
});

test('mission « prise en main » : enable, show ip route, ping', async () => {
  const { type, check } = await start('prise-en-main');
  assert.deepEqual(check().done, [false, false, false]);
  await type('r1', 'en', 'sh ip ro');
  assert.deepEqual(check().done, [true, true, false]);
  await type('pc1', 'ping 10.0.2.10');
  assert.equal(check().complete, true);
});

test('mission « route manquante » : le ping échoue, la route le répare', async () => {
  const { type, check } = await start('route-manquante');
  await type('pc1', 'ping 10.0.2.10');
  assert.deepEqual(check().done, [false, false], 'sans route de retour, pas de réponse');
  await type('r2', 'enable', 'configure terminal', 'ip route 10.0.1.0 255.255.255.0 10.0.12.1', 'end');
  assert.deepEqual(check().done, [true, false]);
  await type('pc1', 'ping 10.0.2.10');
  assert.equal(check().complete, true);
});

test('mission « VLAN erroné » : PC3 retrouve sa passerelle', async () => {
  const { type, check } = await start('vlan-errone');
  await type('pc3', 'ping 192.168.20.1');
  assert.deepEqual(check().done, [false, false]);
  await type('sw1', 'en', 'conf t', 'int gi0/3', 'switchport access vlan 20', 'end');
  await type('pc3', 'ping 192.168.20.1');
  assert.equal(check().complete, true);
});

test('mission « port sécurisé » et « ouvrir le web » (console IOS)', async () => {
  const sec = await start('port-securise');
  assert.equal(sec.check().score, 0);
  await sec.type('sw1', 'en', 'conf t', 'int gi0/1', 'switchport port-security', 'switchport port-security maximum 1', 'switchport port-security mac-address sticky', 'end');
  assert.equal(sec.check().complete, true);

  const web = await start('ouvrir-le-web');
  assert.equal(web.check().score, 0);
  // Tout ouvrir ne suffit pas : le deuxième objectif l'interdit.
  await web.type('fw1', 'en', 'conf t', 'ip access-list extended DEPUIS-INTERNET', 'permit ip any any');
  assert.deepEqual(web.check().done, [true, false]);
  await web.type('fw1', 'no 10', 'permit tcp any host 172.16.1.80 eq 80', 'end');
  assert.equal(web.check().complete, true);
});

test('mission « votre réseau » : construit depuis un labo vide', async () => {
  const { sim, type, check } = await start('mon-reseau');
  assert.equal(check().score, 0);
  let d = B.draftFrom(sim.scenario);
  const add = (t, m) => { const r = B.addDevice(d, t, m ? { model: m } : {}); d = r.draft; return r.id; };
  const pc1 = add('host'); const sw = add('switch', 'sw-24m'); const r = add('router', 'rt-2g'); const pc2 = add('host');
  d = B.addLink(d, pc1, sw).draft; d = B.addLink(d, sw, r).draft; d = B.addLink(d, r, pc2).draft;
  await sim.loadScenario(d);
  assert.deepEqual(check().done.slice(0, 2), [true, true]);
  const rDef = sim.scenario.devices.find((x) => x.id === r);
  const [lan1, lan2] = sim.scenario.links.filter((l) => l.a.startsWith(`${r}:`) || l.b.startsWith(`${r}:`))
    .map((l) => (l.a.startsWith(`${r}:`) ? l.a : l.b).split(':')[1]);
  assert.ok(rDef && lan1 && lan2);
  await type(r, 'en', 'conf t', `interface ${lan1}`, 'ip address 192.168.1.1 255.255.255.0', `interface ${lan2}`, 'ip address 192.168.2.1 255.255.255.0', 'end');
  await type(pc1, 'netsh interface ip set address "eth0" static 192.168.1.10 255.255.255.0 192.168.1.1');
  await type(pc2, 'netsh interface ip set address "eth0" static 192.168.2.10 255.255.255.0 192.168.2.1');
  assert.deepEqual(check().done.slice(0, 4), [true, true, true, true]);
  await type(pc1, 'ping 192.168.2.10');
  assert.equal(check().complete, true);
});
