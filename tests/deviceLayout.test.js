// Disposition des équipements 3D et règle des voyants (src/render/deviceLayout.js) : sans navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceLayout, portLedState, LED_COLORS, TYPE_ACCENTS } from '../src/render/deviceLayout.js';
import { MODELS, portNames } from '../src/sim/catalog.js';

const ALL = Object.entries(MODELS).map(([id, model]) => ({ id, model, layout: deviceLayout({ type: model.type, model: id }) }));

test('équipements 3D : chaque modèle du catalogue a une disposition, avec tous ses ports', () => {
  assert.equal(ALL.length, Object.keys(MODELS).length);
  for (const { id, model, layout } of ALL) {
    assert.equal(layout.modelId, id);
    assert.equal(layout.type, model.type);
    assert.deepEqual(layout.ports.map((port) => port.name), portNames(model), `${id} : ports dans l'ordre du catalogue`);
    for (const value of [layout.width, layout.height, layout.depth]) assert.ok(value > 0 && value < 3, `${id} : dimension ${value}`);
    assert.equal(layout.accent, TYPE_ACCENTS[model.type]);
  }
});

test('équipements 3D : un équipement sans modèle prend le modèle par défaut de son type', () => {
  assert.equal(deviceLayout({ type: 'switch' }).modelId, 'sw-8g');
  assert.equal(deviceLayout({ type: 'host' }).form, 'workstation');
  assert.equal(deviceLayout({ type: 'router', model: 'inconnu' }).modelId, 'rt-2g');
});

test('équipements 3D : les prises sont sur une face du boîtier et ne se chevauchent pas', () => {
  for (const { id, layout } of ALL) {
    for (const port of layout.ports) {
      assert.ok(Math.abs(port.x) <= layout.width / 2, `${id} ${port.name} : x dans le boîtier`);
      assert.ok(port.y > 0 && port.y < layout.height, `${id} ${port.name} : y dans le boîtier`);
      assert.ok(['front', 'back'].includes(port.face));
      assert.equal(Math.sign(port.z), port.face === 'front' ? 1 : -1, `${id} ${port.name} : sur sa face`);
    }
    const front = layout.ports.filter((port) => port.face === 'front');
    for (let i = 0; i < front.length; i += 1) {
      for (let j = i + 1; j < front.length; j += 1) {
        const a = front[i];
        const b = front[j];
        const apart = Math.abs(a.x - b.x) >= 0.074 || Math.abs(a.y - b.y) >= 0.06;
        assert.ok(apart, `${id} : ${a.name} et ${b.name} se chevauchent`);
      }
    }
  }
});

test('équipements 3D : switch 24 ports sur deux rangées (impairs en haut), SFP pour les ports 10 Gb/s', () => {
  const { layout } = ALL.find((entry) => entry.id === 'sw-24g');
  const p1 = layout.ports.find((port) => port.name === 'p1');
  const p2 = layout.ports.find((port) => port.name === 'p2');
  assert.ok(p1.y > p2.y, 'p1 en haut, p2 en bas');
  assert.equal(p1.x, p2.x, 'p1 et p2 dans la même colonne');
  assert.equal(p2.flip, true, 'prise du bas retournée');
  assert.deepEqual(layout.ports.filter((port) => port.kind === 'sfp').map((port) => port.name), ['u1', 'u2']);
  assert.equal(layout.form, 'rack1u');
  assert.equal(layout.ears, true);
});

test('équipements 3D : chaque port a un voyant de lien et un voyant d\'activité', () => {
  for (const { id, layout } of ALL) {
    for (const port of layout.ports) {
      const roles = port.leds.map((led) => led.role);
      assert.ok(roles.includes('link') && roles.includes('act'), `${id} ${port.name}`);
    }
  }
  const pc = deviceLayout({ type: 'host' });
  assert.equal(pc.status.length, 0, 'un poste de travail n\'a pas de voyants d\'état de façade');
  assert.deepEqual(deviceLayout({ type: 'router' }).status.map((led) => led.role), ['pwr', 'sys']);
});

test('équipements 3D : formes et finitions variées selon le modèle', () => {
  const form = (id) => ALL.find((entry) => entry.id === id).layout;
  assert.equal(form('sw-8g').form, 'desktop');
  assert.equal(form('srv-1g').form, 'rack2u');
  assert.equal(form('pc-fe').finish, 'beige');
  assert.equal(form('pc-std').finish, 'dark');
  assert.equal(form('sw-24v').brand, 'VERSA');
  assert.equal(form('fw-3g').brand, 'SHIELD');
  assert.ok(form('rt-2g').extras.console, 'un routeur a une prise console');
  assert.equal(form('sw-8g').extras.console, undefined, 'un switch non administrable n\'en a pas');
  assert.ok(form('srv-10g').extras.bays > form('srv-1g').extras.bays);
});

test('voyants : lien vert à 1 Gb/s, orange à 100 Mb/s, éteint sans câble ou si le port est éteint', () => {
  assert.deepEqual(portLedState({ cabled: false }), { link: 'off', act: 'off' });
  assert.equal(portLedState({ cabled: true, speed: 1000 }).link, 'green');
  assert.equal(portLedState({ cabled: true, speed: 10000 }).link, 'green');
  assert.equal(portLedState({ cabled: true, speed: 100 }).link, 'amber');
  assert.deepEqual(portLedState({ cabled: true, shutdown: true, active: true }), { link: 'off', act: 'off' });
});

test('voyants : l\'activité clignote au rythme du temps simulé, un port bloqué clignote en orange', () => {
  const seen = new Set();
  for (let t = 0; t < 400; t += 10) seen.add(portLedState({ cabled: true, active: true, simNow: t }).act);
  assert.deepEqual([...seen].sort(), ['green', 'off'], 'activité : allumé puis éteint');
  assert.equal(portLedState({ cabled: true, active: false, simNow: 0 }).act, 'off');
  const blocked = new Set();
  for (let t = 0; t < 2000; t += 100) blocked.add(portLedState({ cabled: true, errDisabled: true, realNow: t }).link);
  assert.deepEqual([...blocked].sort(), ['amber', 'off'], 'err-disabled : orange clignotant');
  assert.equal(portLedState({ cabled: true, errDisabled: true, active: true }).act, 'off');
  for (const name of ['off', 'green', 'amber']) assert.match(LED_COLORS[name], /^#[0-9a-f]{6}$/);
});
