import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/sim/eventBus.js';

test('bus : abonnement, publication, désabonnement', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('a', (payload) => seen.push(payload.n));
  bus.emit('a', { n: 1 });
  bus.emit('b', { n: 2 });
  off();
  bus.emit('a', { n: 3 });
  assert.deepEqual(seen, [1]);
  assert.equal(bus.count('a'), 0);
});

test('bus : « * » reçoit tout, avec le nom du sujet', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('*', (payload, topic) => seen.push(topic));
  bus.emit('x');
  bus.emit('y');
  assert.deepEqual(seen, ['x', 'y']);
});

test('bus : once ne reçoit qu\'un évènement', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('a', () => { count += 1; });
  bus.emit('a');
  bus.emit('a');
  assert.equal(count, 1);
});

test('bus : une erreur chez un abonné n\'empêche pas les autres d\'être prévenus', (t) => {
  const bus = new EventBus();
  const errors = t.mock.method(console, 'error', () => {});
  let reached = false;
  bus.on('a', () => { throw new Error('abonné défaillant'); });
  bus.on('a', () => { reached = true; });
  bus.emit('a');
  assert.ok(reached);
  assert.equal(errors.mock.callCount(), 1);
});

test('bus : un abonné peut se désabonner pendant la publication', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('a', () => { seen.push('premier'); off(); });
  bus.on('a', () => seen.push('second'));
  bus.emit('a');
  bus.emit('a');
  assert.deepEqual(seen, ['premier', 'second', 'second']);
  assert.throws(() => bus.on('a', 'pas une fonction'), TypeError);
});
