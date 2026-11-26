import test from 'node:test';
import assert from 'node:assert/strict';
import { Topics } from '../src/sim/events.js';
import tcp, { CLIENT_ISN, SERVER_ISN, TcpState } from '../src/sim/protocols/tcp.js';
import { loadSim, play, noteKeys, missingFor } from './helpers.js';

// Ces tests jouent le scénario « tcp » : ils attendent que toutes ses pièces soient dans le dépôt.
const skip = missingFor('tcp');

const only = (index) => (scenario) => ({ ...scenario, steps: [scenario.steps[index]] });
/** Segments émis par les deux extrémités (on ignore les recopies du switch). */
const segments = (events) => events
  .filter((e) => e.topic === Topics.PACKET_SEND && e.packet.tcp && e.from !== 'sw1')
  .map((e) => ({ from: e.from, ...e.packet.tcp, flags: e.packet.tcp.flags.join(','), data: e.packet.data }));

test('TCP : ouverture en trois temps avec les bons numéros', { skip }, async () => {
  const { events } = await play('tcp', only(0));
  const [syn, synAck, ack] = segments(events);
  assert.deepEqual([syn.from, syn.flags, syn.seq, syn.ack], ['pc1', 'SYN', CLIENT_ISN, 0]);
  assert.deepEqual([synAck.from, synAck.flags, synAck.seq, synAck.ack], ['srv1', 'SYN,ACK', SERVER_ISN, CLIENT_ISN + 1]);
  assert.deepEqual([ack.from, ack.flags, ack.seq, ack.ack], ['pc1', 'ACK', CLIENT_ISN + 1, SERVER_ISN + 1]);
  assert.equal(syn.dstPort, 5000);
  assert.equal(syn.srcPort, 49152);
  assert.equal(synAck.dstPort, syn.srcPort);
  assert.ok(noteKeys(events).includes('tcp.established'));
});

test('TCP : les données sont acquittées par « prochain octet attendu »', { skip }, async () => {
  const { events } = await play('tcp', only(0));
  const all = segments(events);
  const data = all.find((s) => s.flags === 'PSH,ACK');
  const ack = all[all.indexOf(data) + 1];
  assert.equal(data.data, 'Bonjour SUP\'COM');
  assert.equal(data.len, 15);
  assert.equal(data.seq, CLIENT_ISN + 1);
  assert.deepEqual([ack.from, ack.flags, ack.ack, ack.len], ['srv1', 'ACK', CLIENT_ISN + 1 + 15, 0]);
  assert.ok(noteKeys(events).includes('tcp.acked'));
});

test('TCP : fermeture en quatre temps, FIN compte pour un octet', { skip }, async () => {
  const { sim, events } = await play('tcp', only(0));
  const all = segments(events);
  const tail = all.slice(-4);
  assert.deepEqual(tail.map((s) => `${s.from} ${s.flags}`), ['pc1 FIN,ACK', 'srv1 ACK', 'srv1 FIN,ACK', 'pc1 ACK']);
  assert.equal(tail[1].ack, tail[0].seq + 1);
  assert.equal(tail[3].ack, tail[2].seq + 1);
  assert.equal(all.length, 9, '3 (ouverture) + 2 (données) + 4 (fermeture)');
  const states = [...sim.network.tcpConns.values()].map((conn) => conn.state);
  assert.deepEqual(states, [TcpState.CLOSED, TcpState.CLOSED]);
  assert.equal(noteKeys(events).filter((key) => key === 'tcp.closed').length, 2);
  assert.equal(tcp.table(sim.device('pc1')).rows[0][2], 'CLOSED');
});

test('TCP : port fermé, le serveur répond RST et rien n\'est établi', { skip }, async () => {
  const { sim, events } = await play('tcp', only(1));
  const all = segments(events);
  assert.deepEqual(all.map((s) => `${s.from} ${s.flags}`), ['pc1 SYN', 'srv1 RST,ACK']);
  assert.equal(all[1].ack, CLIENT_ISN + 1);
  const keys = noteKeys(events);
  assert.ok(keys.includes('tcp.rst') && keys.includes('tcp.refused'));
  assert.ok(!keys.includes('tcp.established'));
  assert.equal(sim.device('srv1').tcpConns.size, 0);
});

test('TCP : une application peut répondre dans le même segment que l\'acquittement', { skip }, async () => {
  const { sim, events } = await loadSim('tcp', (scenario) => ({ ...scenario, steps: [] }));
  const pc1 = sim.device('pc1');
  const srv1 = sim.device('srv1');
  const got = [];
  tcp.listen(srv1, 7000, { onData: (conn, data) => ({ reply: { data: data.toUpperCase() } }) });
  tcp.connect(pc1, { dst: '192.168.1.20', port: 7000 }, {
    onOpen: (conn) => tcp.send(conn, 'ping'),
    onData: (conn, data) => { got.push(data); return { close: true }; },
  });
  sim.engine.runToEnd();
  assert.deepEqual(got, ['PING']);
  const flags = segments(events).map((s) => `${s.from} ${s.flags}`);
  assert.deepEqual(flags, [
    'pc1 SYN', 'srv1 SYN,ACK', 'pc1 ACK',
    'pc1 PSH,ACK', 'srv1 PSH,ACK',
    'pc1 FIN,ACK', 'srv1 ACK', 'srv1 FIN,ACK', 'pc1 ACK',
  ]);
  const reply = segments(events)[4];
  assert.equal(reply.ack, CLIENT_ISN + 1 + 4, 'la réponse acquitte les 4 octets reçus');
  assert.equal(tcp.describe({ tcp: { srcPort: 1, dstPort: 2, flags: ['SYN'], seq: 5, ack: 0, len: 0 } })[4].value, '—');
});
