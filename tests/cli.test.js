// Consoles des équipements (laboratoire de Steve, S7) : styles ios, vrp et PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsole, displayName, formatRun, resolveIface, runningConfig } from '../src/sim/cli.js';
import { prefixOf, maskOf, wildcardPrefix, normalizeMac } from '../src/sim/config.js';
import * as B from '../src/sim/builder.js';
import { createSimulation, Topics } from '../simulation.js';
import { readScenario } from './helpers.js';

/** Simulation + console ; `type(lines)` exécute et applique les changements comme l'interface. */
async function lab(scenario, deviceId) {
  const sim = createSimulation();
  await sim.loadScenario(scenario);
  const api = { scenario: () => sim.scenario, device: (id) => sim.device(id), lang: () => 'en', now: () => sim.now };
  const con = createConsole(api, deviceId);
  const type = async (...lines) => {
    let last = null;
    for (const line of lines) {
      last = con.execute(line);
      if (last.scenario) await sim.loadScenario(last.scenario);
    }
    return last;
  };
  return { sim, con, type };
}

test('console : masques, jokers et adresses MAC', () => {
  assert.equal(prefixOf('255.255.255.0'), 24);
  assert.equal(prefixOf('/30'), 30);
  assert.equal(prefixOf('255.0.255.0'), null);
  assert.equal(maskOf(29), '255.255.255.248');
  assert.equal(wildcardPrefix('0.0.0.255'), 24);
  assert.equal(normalizeMac('0200.0000.5e12'), '02:00:00:00:5E:12');
});

test('console : noms d\'interfaces dans les deux styles', () => {
  const sw = { type: 'switch', model: 'sw-24m' };
  assert.equal(displayName('ios', 'p3'), 'GigabitEthernet0/3');
  assert.equal(displayName('vrp', 'u1'), 'XGigabitEthernet0/0/1');
  for (const text of ['g0/3', 'gi0/3', 'GigabitEthernet0/3', 'fa0/3', 'p3']) assert.equal(resolveIface('ios', sw, text), 'p3', text);
  assert.equal(resolveIface('ios', sw, 'te1/1'), 'u1');
  assert.equal(resolveIface('vrp', { type: 'switch', model: 'sw-24v' }, 'GE0/0/7'), 'p7');
  const r = { type: 'router', interfaces: [{ name: 'g0/0' }, { name: 'g0/1' }] };
  assert.equal(resolveIface('ios', r, 'gi0/1'), 'g0/1');
  assert.equal(resolveIface('ios', r, 'g0/0.10'), null, 'sous-interface absente');
  assert.equal(resolveIface('ios', r, 'g0/0.10', { allowSub: true }), 'g0/0.10');
});

test('console ios : modes, abréviations, aide et erreurs', async () => {
  const { con, type } = await lab(readScenario('routage'), 'r1');
  assert.equal(con.prompt(), 'R1>');
  await type('en');
  assert.equal(con.prompt(), 'R1#');
  const brief = await type('sh ip int br');
  assert.ok(brief.lines.some((l) => l.startsWith('Gi0/0') && l.includes('10.0.1.1')));
  const route = await type('show ip route');
  assert.ok(route.lines.some((l) => l.startsWith('S') && l.includes('via 10.0.12.2')));
  assert.match((await type('foo')).lines.join('\n'), /Invalid input detected/);
  assert.match((await type('show ip')).lines.join('\n'), /Incomplete command/);
  assert.match((await type('c')).lines.join('\n'), /Ambiguous command/, '« c » : configure, copy ou clear');
  assert.ok(con.execute('show ?').lines.some((l) => l.includes('running-config')));
  assert.equal(con.complete('conf'), 'configure ');
  await type('conf t');
  assert.equal(con.prompt(), 'R1(config)#');
  await type('int g0/1');
  assert.equal(con.prompt(), 'R1(config-if)#');
  assert.ok((await type('do show ip route')).lines.length > 2, '« do » depuis la configuration');
  assert.equal(con.prompt(), 'R1(config-if)#');
});

test('console ios : la configuration change vraiment le réseau', async () => {
  const { sim, con, type } = await lab(readScenario('routage'), 'r2');
  await type('enable', 'configure terminal', 'no ip route 10.0.1.0 255.255.255.0 10.0.12.1', 'end');
  assert.equal((sim.scenario.devices.find((d) => d.id === 'r2').routes || []).length, 0);
  // Sans la route retour, le ping de PC1 échoue ; on la remet et il passe.
  const pingOk = async () => {
    const events = [];
    const off = sim.on(Topics.PACKET_RECEIVE, (e) => events.push(e));
    sim.runAction({ action: 'ping', from: 'pc1', to: 'pc2' });
    sim.engine.runToEnd();
    off();
    return events.some((e) => e.accepted && e.device === 'pc1' && /Echo Reply/.test(e.packet.label));
  };
  assert.equal(await pingOk(), false);
  await type('conf t', 'ip route 10.0.1.0 255.255.255.0 10.0.12.1', 'interface gi0/0', 'description vers R1', 'end');
  assert.equal(await pingOk(), true);
  const run = runningConfig(sim.scenario.devices.find((d) => d.id === 'r2'));
  assert.ok(run.includes('ip route 10.0.1.0 255.255.255.0 10.0.12.1'));
  assert.ok(run.includes(' description vers R1'));
  assert.equal(con.execute('ping 10.0.1.10').run.steps[0].count, 5);
});

test('console ios : VLAN, trunk, sécurité de port sur un switch administrable', async () => {
  const { sim, type } = await lab(readScenario('vlan'), 'sw1');
  await type('en', 'conf t', 'vlan 30', 'name INVITES', 'exit', 'interface gi0/5', 'switchport mode access', 'switchport access vlan 30',
    'switchport port-security', 'switchport port-security maximum 2', 'switchport port-security mac-address sticky', 'interface te1/1',
    'switchport trunk allowed vlan 10,20,30', 'end');
  const sw = sim.scenario.devices.find((d) => d.id === 'sw1');
  assert.equal(sw.vlans['30'], 'INVITES');
  assert.deepEqual(sw.ports.p5, { vlan: 30, security: { maximum: 2, violation: 'shutdown', sticky: true } });
  assert.deepEqual(sw.ports.u1.allowed, [10, 20, 30]);
  const vlans = await type('show vlan brief');
  assert.ok(vlans.lines.some((l) => l.startsWith('30') && l.includes('INVITES') && l.includes('Gi0/5')));
  const bad = await type('conf t', 'interface gi0/1', 'ip address 10.0.0.1 255.0.0.0');
  assert.ok(bad.error, 'pas d\'adresse IP sur un port de switch');
});

test('console ios : pare-feu — ACL, NAT et sessions', async () => {
  const { sim, type } = await lab(readScenario('pare-feu'), 'fw1');
  await type('en', 'conf t', 'ip access-list extended DEPUIS-INTERNET', '20 permit icmp any host 172.16.1.80', 'end');
  const acl = sim.scenario.devices.find((d) => d.id === 'fw1').acls['DEPUIS-INTERNET'];
  assert.deepEqual(acl[1], { action: 'permit', proto: 'icmp', src: 'any', dst: 'host 172.16.1.80' });
  sim.runAction({ action: 'ping', from: 'pc1', to: 'ext' });
  sim.engine.runToEnd();
  assert.ok((await type('show ip nat translations')).lines.some((l) => l.includes('203.0.113.2')));
  assert.ok((await type('show conn')).lines[0].startsWith('1 in use'));
});

test('console vrp : system-view, VLAN, sous-interfaces et ACL', async () => {
  let d = B.emptyDraft();
  const add = (t, m) => { const r = B.addDevice(d, t, m ? { model: m } : {}); d = r.draft; return r.id; };
  const pc1 = add('host'); const sw = add('switch', 'sw-24v'); const r = add('router', 'rt-2v');
  d = B.addLink(d, pc1, sw).draft; d = B.addLink(d, sw, r).draft;
  const { sim, con, type } = await lab(d, sw);
  assert.equal(con.prompt(), '<SW1>');
  await type('system-view', 'vlan batch 10 to 12', 'interface GigabitEthernet 0/0/2', 'port link-type trunk', 'port trunk allow-pass vlan 10 11', 'return');
  const swDef = sim.scenario.devices.find((x) => x.id === sw);
  assert.deepEqual(Object.keys(swDef.vlans), ['10', '11', '12']);
  assert.deepEqual(swDef.ports.p2, { mode: 'trunk', allowed: [10, 11] });
  assert.ok((await type('display vlan')).lines[0].includes('4'));
  const router = createConsole({ scenario: () => sim.scenario, device: (id) => sim.device(id), lang: () => 'en' }, r);
  for (const line of ['system-view', 'interface GigabitEthernet0/0/0.10', 'dot1q termination vid 10', 'ip address 192.168.10.1 24', 'quit', 'acl name WEB advance', 'rule permit tcp destination 192.168.10.5 0 destination-port eq 80']) {
    const res = router.execute(line);
    assert.ok(!res.error, `${line} → ${res.lines.join(' ')}`);
    if (res.scenario) await sim.loadScenario(res.scenario);
  }
  const rDef = sim.scenario.devices.find((x) => x.id === r);
  assert.deepEqual(rDef.interfaces.find((i) => i.name === 'g0/0/0.10'), { name: 'g0/0/0.10', vlan: 10, ip: '192.168.10.1', prefix: 24 });
  assert.deepEqual(rDef.acls.WEB, [{ action: 'permit', proto: 'tcp', src: 'any', dst: 'host 192.168.10.5', port: 80 }]);
  assert.match(router.execute('display foo').lines.join('\n'), /Unrecognized command/);
  assert.ok(runningConfig(rDef).includes(' dot1q termination vid 10'));
});

test('console PC : ipconfig, netsh, ping et résultats', async () => {
  const { sim, con, type } = await lab(readScenario('ping'), 'pc1');
  assert.equal(con.prompt(), 'C:\\Users\\steve>');
  assert.ok((await type('ipconfig')).lines.some((l) => l.includes('192.168.1.10')));
  await type('netsh interface ip set address "eth0" static 192.168.1.50 255.255.255.0 192.168.1.1');
  assert.equal(sim.scenario.devices.find((x) => x.id === 'pc1').interfaces[0].ip, '192.168.1.50');
  assert.equal(con.execute('ping 192.168.1.11').run.steps[0].count, 4);
  assert.match(con.execute('dir').lines.join(''), /not recognized/);
  const ping = formatRun('ios', { kind: 'ping', count: 5, target: '10.0.0.1' }, [{ type: 'timeout' }, ...Array(4).fill({ type: 'reply' })]);
  assert.deepEqual(ping, ['.!!!!', 'Success rate is 80 percent (4/5), round-trip min/avg/max = 1/1/2 ms']);
  const trace = formatRun('pc', { kind: 'trace', target: '10.0.0.1' }, [{ type: 'ttl', from: '10.0.0.254' }, { type: 'reply', from: '10.0.0.1' }]);
  assert.equal(trace.length, 4);
});
