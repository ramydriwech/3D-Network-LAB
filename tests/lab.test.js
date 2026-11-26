// Laboratoire (S6) : VLAN, sous-interfaces, sécurité des ports, ACL, NAT et pare-feu à états.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import { NatTable, PortSecurity, evaluateAcl, parseMatch, ruleText, checkRule } from '../src/sim/security.js';
import { validateScenario } from '../src/sim/scenario.js';
import { play, readScenario, noteKeys, missingFor } from './helpers.js';

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
const replies = (events, device) => events.filter((e) => e.topic === Topics.PACKET_RECEIVE && e.accepted && e.device === device && /Echo Reply/.test(e.packet.label)).length;
const receivedBy = (events, device, label) => events.some((e) => e.topic === Topics.PACKET_RECEIVE && e.device === device && e.packet.label === label);

test('sécurité : lecture et évaluation des règles d\'ACL', () => {
  assert.deepEqual(parseMatch('any'), { any: true, text: 'any' });
  assert.equal(parseMatch('host 10.0.0.5').prefix, 32);
  assert.equal(parseMatch('10.0.0.0/8').prefix, 8);
  assert.equal(parseMatch('n\'importe'), null);
  assert.match(checkRule({ action: 'permit', proto: 'icmp', src: 'any', dst: 'any', port: 80 }), /tcp ou udp/);
  const rules = [
    { action: 'deny', proto: 'tcp', src: 'any', dst: 'host 10.0.0.5', port: 22 },
    { action: 'permit', proto: 'ip', src: '192.168.0.0/16', dst: 'any' },
  ];
  const packet = (src, dst, extra = {}) => ({ ip: { src, dst, proto: extra.tcp ? 'TCP' : 'ICMP' }, ...extra });
  assert.equal(evaluateAcl(rules, packet('192.168.1.2', '10.0.0.5', { tcp: { dstPort: 22 } })).permit, false);
  assert.equal(evaluateAcl(rules, packet('192.168.1.2', '10.0.0.5', { tcp: { dstPort: 80 } })).index, 1);
  const implicit = evaluateAcl(rules, packet('8.8.8.8', '10.0.0.5'));
  assert.deepEqual([implicit.permit, implicit.index], [false, -1], 'refus implicite final');
  assert.equal(ruleText(rules[0]), 'deny tcp any host 10.0.0.5 eq 22');
});

test('sécurité : NAT overload — un port public par flux, et le retour', () => {
  const nat = new NatTable([{ type: 'overload' }]);
  const a = nat.translateOut({ ip: { src: '192.168.1.10', dst: '8.8.8.8', proto: 'UDP' }, udp: { srcPort: 5000, dstPort: 53 } }, '203.0.113.2');
  const b = nat.translateOut({ ip: { src: '192.168.1.11', dst: '8.8.8.8', proto: 'UDP' }, udp: { srcPort: 5000, dstPort: 53 } }, '203.0.113.2');
  assert.equal(a.ip.src, '203.0.113.2');
  assert.notEqual(a.udp.srcPort, b.udp.srcPort, 'deux postes, deux ports publics');
  const back = nat.translateIn({ ip: { src: '8.8.8.8', dst: '203.0.113.2', proto: 'UDP' }, udp: { srcPort: 53, dstPort: b.udp.srcPort } });
  assert.deepEqual([back.ip.dst, back.udp.dstPort], ['192.168.1.11', 5000]);
  assert.equal(nat.translateIn({ ip: { src: '8.8.8.8', dst: '203.0.113.2', proto: 'UDP' }, udp: { srcPort: 53, dstPort: 1 } }), null, 'rien d\'inconnu n\'entre');
});

test('sécurité : port sécurisé — apprentissage sticky puis violation', () => {
  const port = new PortSecurity({ maximum: 1, sticky: true });
  assert.equal(port.check('02:00:00:00:00:01'), 'learn');
  assert.equal(port.check('02:00:00:00:00:01'), 'allow');
  assert.equal(port.check('02:00:00:00:00:99'), 'violation');
  assert.equal(port.errDisabled, true);
  const restrict = new PortSecurity({ macs: ['02:00:00:00:00:01'], violation: 'restrict' });
  assert.equal(restrict.check('02:00:00:00:00:02'), 'violation');
  assert.equal(restrict.errDisabled, false, 'restrict : le port reste actif');
});

test('scénarios du laboratoire : valides, et erreurs claires', () => {
  // Le scénario VLAN et celui de la sécurité de port arrivent avec le switch administrable (Ayoub).
  for (const name of ['vlan', 'pare-feu', 'securite-port'].filter((n) => !missingFor(n))) assert.deepEqual(validateScenario(readScenario(name)).errors, [], name);
  const broken = readScenario('pare-feu');
  const fw = broken.devices.find((d) => d.id === 'fw1');
  fw.interfaces[1].acl = { in: 'ABSENTE' };
  fw.nat.push({ type: 'magique' });
  fw.acls['DEPUIS-INTERNET'].push({ action: 'allow', proto: 'tcp', src: 'any', dst: 'any' });
  const errors = validateScenario(broken).errors.join('\n');
  for (const part of ['ABSENTE', 'static ou overload', 'permit ou deny']) assert.ok(errors.includes(part), part);
});

test('VLAN : une diffusion reste dans son VLAN, le routeur relie les VLAN', { skip: missingFor('vlan') }, async () => {
  const one = await play('vlan', only(0));
  assert.ok(receivedBy(one.events, 'pc2', 'ARP Request'));
  assert.ok(!receivedBy(one.events, 'pc3', 'ARP Request') && !receivedBy(one.events, 'pc4', 'ARP Request'), 'le VLAN 20 ne voit rien');
  const trunk = one.events.find((e) => e.topic === Topics.PACKET_SEND && e.from === 'sw1' && e.to === 'r1');
  assert.equal(trunk.packet.vlan, 10, 'étiquette 802.1Q sur le trunk');
  const access = one.events.find((e) => e.topic === Topics.PACKET_SEND && e.from === 'sw1' && e.to === 'pc2');
  assert.equal(access.packet.vlan, undefined, 'pas d\'étiquette vers un port d\'accès');
  assert.equal(replies(one.events, 'pc1'), 1);
  const two = await play('vlan', only(1));
  assert.equal(replies(two.events, 'pc1'), 1, 'routage entre VLAN par les sous-interfaces');
  assert.ok(two.events.some((e) => e.topic === Topics.PACKET_SEND && e.from === 'r1' && e.packet.vlan === 20));
  assert.deepEqual(two.sim.device('sw1').tables()[0].columns.length, 3, 'la table MAC affiche la colonne VLAN');
});

test('pare-feu : NAT, session, ACL d\'entrée, DMZ', { skip: missingFor('pare-feu') }, async () => {
  const out = await play('pare-feu', only(0));
  assert.equal(replies(out.events, 'pc1'), 1);
  const onInternet = out.events.find((e) => e.topic === Topics.PACKET_SEND && e.from === 'isp' && /Echo Request/.test(e.packet.label));
  assert.equal(onInternet.packet.ip.src, '203.0.113.2', 'l\'adresse privée ne sort pas');
  assert.ok(noteKeys(out.events).includes('fw.return'));
  assert.equal(out.sim.device('fw1').nat.entries.length, 1);

  const blocked = await play('pare-feu', only(1));
  assert.equal(replies(blocked.events, 'pirate'), 0);
  assert.ok(blocked.events.some((e) => e.topic === Topics.PACKET_DROP && e.device === 'fw1' && e.notes.some((n) => n.key === 'acl.deny')));
  assert.ok(!blocked.events.some((e) => e.topic === Topics.PACKET_RECEIVE && e.device === 'web1' && /Echo/.test(e.packet.label)));

  const web = await play('pare-feu', only(2));
  assert.equal(web.sim.device('pirate').httpLast.status, 200, 'le port 80 de la DMZ est ouvert');
  assert.equal(web.sim.device('fw1').aclHits.get('DEPUIS-INTERNET')[0] > 0, true);
});

test('pare-feu : sans session, Internet ne peut pas entrer (zone moins sûre)', { skip: missingFor('pare-feu') }, async () => {
  const { events } = await play('pare-feu', (s) => {
    const fw = s.devices.find((d) => d.id === 'fw1');
    fw.acls['DEPUIS-INTERNET'] = [{ action: 'permit', proto: 'ip', src: 'any', dst: 'any' }];
    fw.nat = [{ type: 'static', inside: '192.168.1.10', outside: '203.0.113.6' }];
    return { ...s, steps: [{ action: 'ping', from: 'pirate', to: '203.0.113.6' }] };
  });
  // L'ACL laisse passer : c'est une règle explicite, le pare-feu l'accepte.
  assert.ok(noteKeys(events).includes('fw.acl'));
  const { events: noAcl } = await play('pare-feu', (s) => {
    const fw = s.devices.find((d) => d.id === 'fw1');
    delete fw.interfaces[1].acl;
    fw.nat = [{ type: 'static', inside: '192.168.1.10', outside: '203.0.113.6' }];
    return { ...s, steps: [{ action: 'ping', from: 'pirate', to: '203.0.113.6' }] };
  });
  assert.ok(noteKeys(noAcl).includes('fw.block'), 'outside → inside sans règle : bloqué');
});

test('sécurité des ports : intrus coupé (err-disabled), puis plus rien ne passe', { skip: missingFor('securite-port') }, async () => {
  const { sim, events } = await play('securite-port');
  const keys = noteKeys(events);
  assert.ok(keys.includes('switch.sec.learn') && keys.includes('switch.sec.violation') && keys.includes('net.ifaceDown'));
  assert.equal(replies(events, 'pc1'), 1);
  assert.equal(replies(events, 'intrus'), 0);
  assert.equal(sim.device('sw1').iface('p2').errDisabled, true);
  assert.deepEqual([...sim.device('sw1').security.get('p1').learned], ['02:00:00:00:5E:11']);
});

test('interface éteinte : rien ne passe', { skip: missingFor('routage') }, async () => {
  const { events } = await play('routage', (s) => {
    s.devices.find((d) => d.id === 'r1').interfaces[1].shutdown = true;
    return { ...s, steps: [s.steps[0]] };
  });
  assert.ok(noteKeys(events).includes('net.ifaceDown'));
});
