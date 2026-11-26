// Tests de non-régression du moteur : chaque scénario du catalogue est joué en entier et
// la suite exacte des messages est comparée à un enregistrement de référence
// (tests/golden/<scénario>.txt). Si le moteur ou un protocole change de comportement,
// même légèrement, ce test le signale.
//
// Mettre à jour les références après un changement VOULU :
//   UPDATE_GOLDEN=1 node --test tests/regression.test.js      (PowerShell : $env:UPDATE_GOLDEN=1)
// puis relire le diff git des fichiers golden avant de valider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Topics } from '../src/sim/events.js';
import { validateScenario } from '../src/sim/scenario.js';
import { loadSim, readScenario } from './helpers.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../scenarios/index.json', import.meta.url), 'utf8'));
const names = catalog.scenarios.map((entry) => entry.file.replace(/\.json$/, ''));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Trace lisible et complète d'une lecture : date, trajet, message, diffusion, acceptation. */
async function trace(name) {
  const { sim, events } = await loadSim(name);
  sim.engine.runToEnd();
  const label = (id) => (sim.device(id) ? sim.device(id).name : id);
  const lines = [];
  for (const event of events) {
    if (event.topic === Topics.STEP) lines.push(`--- étape ${event.index + 1}`);
    else if (event.topic === Topics.PACKET_SEND) lines.push(`${event.time} ${label(event.from)}>${label(event.to)} ${event.packet.label} [${event.packet.cast}]`);
    else if (event.topic === Topics.PACKET_RECEIVE && !event.accepted) lines.push(`${event.time} ${label(event.device)} ignore ${event.packet.label}`);
    else if (event.topic === Topics.PACKET_DROP) lines.push(`${event.time} ${label(event.device)} détruit ${event.packet.label}`);
  }
  lines.push(`fin ${sim.now} ${sim.state}`);
  return { sim, events, text: lines.join('\n') + '\n' };
}

test('catalogue : chaque scénario existe, est valide et porte le bon identifiant', () => {
  assert.ok(names.includes(catalog.default.replace(/\.json$/, '')), 'le scénario par défaut est dans la liste');
  for (const name of names) {
    const scenario = readScenario(name);
    assert.deepEqual(validateScenario(scenario).errors, [], name);
    assert.equal(scenario.id, name, `${name}.json doit avoir "id": "${name}"`);
  }
});

for (const name of names) {
  test(`non-régression : ${name}`, async () => {
    const first = await trace(name);
    const golden = new URL(`./golden/${name}.txt`, import.meta.url);
    if (UPDATE) {
      fs.mkdirSync(new URL('./golden/', import.meta.url), { recursive: true });
      fs.writeFileSync(golden, first.text);
    }
    // Les fins de ligne Windows (\r\n) sont tolérées : seul le contenu compte.
    assert.equal(first.text, fs.readFileSync(golden, 'utf8').replace(/\r\n/g, '\n'), `la trace de « ${name} » a changé`);
    assert.equal(first.sim.state, 'finished');

    // Déterminisme : une seconde lecture donne exactement la même trace.
    assert.equal((await trace(name)).text, first.text);

    // Chaque explication publiée a un texte en français et en anglais.
    for (const event of first.events) {
      for (const note of event.notes || []) {
        const text = first.sim.text(note.key);
        assert.ok(text && text.fr && text.en, `texte manquant pour « ${note.key} »`);
      }
    }
  });
}

test('non-régression : pas à pas et lecture continue donnent la même trace', async () => {
  const stepped = await loadSim(catalog.default.replace(/\.json$/, ''));
  let guard = 0;
  while (stepped.sim.state !== 'finished' && guard++ < 1000) stepped.sim.execute('step', { instant: true });
  const continuous = await loadSim(catalog.default.replace(/\.json$/, ''));
  continuous.sim.engine.runToEnd();
  const sent = (run) => run.events.filter((e) => e.topic === Topics.PACKET_SEND).map((e) => `${e.time} ${e.from}>${e.to} ${e.packet.label}`);
  assert.deepEqual(sent(stepped), sent(continuous));
});

test('non-régression : réinitialiser remet les tables à zéro', async () => {
  const { sim } = await loadSim('ping');
  sim.engine.runToEnd();
  assert.ok(sim.device('pc1').arpCache.size > 0);
  sim.execute('reset');
  assert.equal(sim.state, 'ready');
  assert.equal(sim.now, 0);
  assert.equal(sim.device('pc1').arpCache.size, 0);
});
