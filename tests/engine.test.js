import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/sim/engine.js';
import { SimState, StateMachine } from '../src/sim/state.js';
import { Topics } from '../src/sim/events.js';
import { loadSim, sends } from './helpers.js';

test('moteur : les évènements sont traités par date, puis par ordre de programmation', () => {
  const engine = new Engine();
  const order = [];
  engine.schedule(300, () => order.push('c'));
  engine.schedule(100, () => order.push('a1'));
  engine.schedule(100, () => order.push('a2'));
  engine.schedule(200, () => { order.push('b'); engine.schedule(0, () => order.push('b+0')); });
  engine.play();
  engine.advance(250);
  assert.deepEqual(order, ['a1', 'a2', 'b', 'b+0']);
  assert.equal(engine.now, 250);
  engine.advance(1000);
  assert.deepEqual(order, ['a1', 'a2', 'b', 'b+0', 'c']);
  assert.equal(engine.state, SimState.FINISHED);
  assert.equal(engine.now, 300, 'l\'horloge s\'arrête au dernier évènement');
});

test('moteur : le résultat ne dépend pas du découpage en images', () => {
  const run = (frames) => {
    const engine = new Engine();
    const log = [];
    for (const delay of [50, 400, 400, 990]) engine.schedule(delay, () => log.push(engine.now));
    engine.play();
    for (const dt of frames) engine.tick(dt);
    return log;
  };
  assert.deepEqual(run([1000]), run(Array(100).fill(10)));
  assert.deepEqual(run([1000]), run([333, 333, 334]));
});

test('moteur : pause, vitesse et annulation', () => {
  const engine = new Engine();
  let fired = 0;
  engine.schedule(1000, () => { fired += 1; });
  const cancelled = engine.schedule(500, () => { fired += 10; });
  assert.equal(engine.cancel(cancelled), true);
  assert.equal(engine.cancel(cancelled), false);

  engine.tick(5000);
  assert.equal(engine.now, 0, 'rien n\'avance tant qu\'on n\'a pas lancé la lecture');
  engine.play();
  engine.setSpeed(2);
  engine.tick(250); // 500 ms simulées
  assert.equal(engine.now, 500);
  engine.pause();
  engine.tick(5000);
  assert.equal(engine.now, 500, 'en pause, le temps simulé est figé');
  assert.equal(fired, 0);
  engine.play();
  engine.tick(250);
  assert.equal(fired, 1);
  assert.equal(engine.setSpeed(0), false);
});

test('moteur : le pas à pas s\'arrête à chaque frontière puis termine', () => {
  const engine = new Engine();
  const log = [];
  engine.schedule(100, () => log.push('départ 1'));
  engine.schedule(1100, () => log.push('arrivée 1'), { boundary: true });
  engine.schedule(1300, () => log.push('départ 2'));
  engine.schedule(2300, () => log.push('arrivée 2'), { boundary: true });

  engine.step({ instant: true });
  assert.deepEqual(log, ['départ 1', 'arrivée 1']);
  assert.equal(engine.state, SimState.PAUSED);
  assert.equal(engine.now, 1100);

  engine.step(); // version animée : il faut faire avancer l'horloge
  assert.equal(engine.state, SimState.PLAYING);
  engine.tick(600);
  assert.equal(log.length, 3);
  engine.tick(5000);
  assert.equal(log.length, 4);
  assert.equal(engine.now, 2300, 'le pas ne dépasse jamais la frontière');
  assert.equal(engine.state, SimState.FINISHED, 'plus rien à jouer : terminé');
  assert.equal(engine.step(), false);
});

test('moteur : onIdle peut programmer la suite, reset remet tout à zéro', () => {
  const engine = new Engine();
  let rounds = 0;
  let resets = 0;
  engine.onReset = () => { resets += 1; };
  engine.onIdle = () => {
    if (rounds >= 3) return false;
    rounds += 1;
    engine.schedule(100, () => {});
    return true;
  };
  engine.runToEnd();
  assert.equal(rounds, 3);
  assert.equal(engine.now, 300);
  assert.equal(engine.state, SimState.FINISHED);
  assert.equal(engine.can('play'), false);
  engine.reset();
  assert.equal(resets, 1);
  assert.equal(engine.now, 0);
  assert.equal(engine.state, SimState.READY);
  assert.equal(engine.pending(), 0);
});

test('états : transitions autorisées et interdites', () => {
  const changes = [];
  const machine = new StateMachine({ emit: (topic, payload) => changes.push(`${payload.previous}>${payload.state}`) });
  assert.ok(machine.can('play') && machine.can('step') && !machine.can('pause'));
  assert.throws(() => machine.to(SimState.PAUSED), /Transition interdite/);
  machine.to(SimState.PLAYING);
  machine.to(SimState.PAUSED);
  machine.to(SimState.PLAYING);
  machine.to(SimState.FINISHED);
  assert.throws(() => machine.to(SimState.PLAYING), /Transition interdite/);
  assert.ok(machine.can('reset') && !machine.can('play'));
  machine.reset();
  assert.deepEqual(changes, ['ready>playing', 'playing>paused', 'paused>playing', 'playing>finished', 'finished>ready']);
});

test('simulation : le paquet de test traverse la topologie de démonstration', async () => {
  const { sim, events } = await loadSim('topologie-demo');
  sim.execute('step', { instant: true });
  assert.deepEqual(sends(events, sim), ['PC1>SW1 Test']);
  assert.equal(sim.state, 'paused');
  sim.execute('play');
  sim.tick(60000);
  assert.deepEqual(sends(events, sim), ['PC1>SW1 Test', 'SW1>R1 Test', 'R1>SW2 Test', 'SW2>SRV1 Test']);
  assert.equal(sim.state, 'finished');
  const send = events.find((event) => event.topic === Topics.PACKET_SEND);
  // Durée = traversée du câble (1 000 ms) + temps d'émission de la trame à la vitesse du lien.
  assert.equal(send.duration, 1000 + send.sending);
  assert.ok(send.bytes >= 64 && send.sending >= 1);
  assert.equal(send.linkId, 'l1');
  assert.ok(sim.text(send.notes[0].key).fr.includes('Paquet de test'));

  // La réinitialisation permet de rejouer exactement la même séquence.
  events.length = 0;
  sim.execute('reset');
  sim.engine.runToEnd();
  assert.equal(sends(events, sim).length, 4);
});
