// L'API de rendu est un contrat : le vrai rendu et le faux (mock) doivent fournir
// exactement les mêmes fonctions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RENDER_API } from '../src/render/api.mjs';
import { createMockRender } from '../src/render/mockRender.mjs';

test('API de rendu : le mock fournit toutes les fonctions du contrat', () => {
  const render = createMockRender();
  for (const name of RENDER_API) assert.ok(name in render, `« ${name} » manque dans le mock`);
  assert.equal(render.isMock, true);
});

test('API de rendu : le mock note les appels et simule une image', () => {
  const render = createMockRender();
  render.showTopology({ devices: [] });
  render.highlight(['pc1']);
  assert.deepEqual(render.calls.map((call) => call.name), ['showTopology', 'highlight']);
  let ticks = 0;
  let frames = 0;
  const off = render.onFrame(() => { frames += 1; });
  render.start(() => { ticks += 1; });
  render.step(16);
  off();
  render.step(16);
  assert.equal(ticks, 2);
  assert.equal(frames, 1, 'le désabonnement de onFrame fonctionne');
  assert.equal(typeof render.packetColor({ protocol: 'arp' }), 'string');
  assert.deepEqual(Object.keys(render.packetStyle({})).sort(), ['cast', 'color']);
});

test('API de rendu : le vrai rendu déclare chaque fonction du contrat', () => {
  // index.mjs a besoin d'une carte graphique : on vérifie son texte plutôt que de l'exécuter.
  const source = readFileSync(new URL('../src/render/index.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('const render = {'));
  for (const name of RENDER_API) {
    assert.match(body, new RegExp(`\\b${name}\\b`), `« ${name} » manque dans src/render/index.mjs`);
  }
});

test('API de rendu : la qualité se lit et se change (mock)', () => {
  const render = createMockRender();
  assert.deepEqual(render.quality, { setting: 'auto', level: 'low', auto: 'low' });
  assert.deepEqual(render.setQuality('high'), { setting: 'high', level: 'high', auto: 'low' });
  assert.equal(render.quality.level, 'high');
  assert.deepEqual(render.calls.at(-1), { name: 'setQuality', args: ['high'] });
});

test("API de rendu : l'échelle d'affichage se lit et se change (mock)", () => {
  const render = createMockRender();
  assert.equal(render.viewScale, 1);
  render.setViewScale(1.5);
  assert.equal(render.viewScale, 1.5);
  assert.deepEqual(render.calls.at(-1), { name: 'setViewScale', args: [1.5] });
  render.setViewScale(0); // valeur absurde : retour à 1
  assert.equal(render.viewScale, 1);
});
