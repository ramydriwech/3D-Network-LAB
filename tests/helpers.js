// Outils communs aux tests : charger un scénario depuis le disque et enregistrer ce que
// publie la simulation.

import { existsSync, readFileSync } from 'node:fs';
import { createSimulation, Topics } from '../simulation.js';

export function readScenario(name) {
  return JSON.parse(readFileSync(new URL(`../scenarios/${name}.json`, import.meta.url), 'utf8'));
}

const DEVICE_FILES = { host: 'host', server: 'host', router: 'router', switch: 'switch', firewall: 'firewall' };

/**
 * Ce qu'il manque encore dans le dépôt pour jouer un scénario, ou `false` si tout est là.
 *
 * Le travail est réparti entre quatre personnes : le test d'un protocole peut avoir besoin
 * du scénario, du switch ou d'un protocole écrits par quelqu'un d'autre et pas encore
 * fusionnés. Dans ce cas le test est mis en attente (« skip ») avec la raison affichée, au
 * lieu d'échouer ; il s'active tout seul dès que la pièce manquante arrive dans main.
 *
 *   const skip = missingFor('ping');
 *   test('ARP : …', { skip }, async () => { … });
 */
export function missingFor(name) {
  const here = (file) => existsSync(new URL(`../${file}`, import.meta.url));
  const file = `scenarios/${name}.json`;
  if (!here(file)) return `en attente de ${file}`;
  const scenario = readScenario(name);
  const needed = [
    ...(scenario.protocols || []).map((id) => `src/sim/protocols/${id}.js`),
    ...[...new Set(scenario.devices.map((device) => DEVICE_FILES[device.type]))].map((id) => `src/sim/devices/${id}.js`),
  ];
  const missing = needed.filter((item) => !here(item));
  return missing.length ? `en attente de ${missing.join(', ')}` : false;
}

/** Crée une simulation, charge le scénario et enregistre tous les évènements publiés. */
export async function loadSim(name, edit = (scenario) => scenario) {
  const sim = createSimulation();
  const events = [];
  sim.on('*', (payload, topic) => events.push({ topic, ...payload }));
  await sim.loadScenario(edit(readScenario(name)));
  events.length = 0;
  return { sim, events };
}

/** Lit le scénario jusqu'au bout et retourne les évènements. */
export async function play(name, edit) {
  const { sim, events } = await loadSim(name, edit);
  sim.engine.runToEnd();
  return { sim, events };
}

/** Les émissions de paquets sous forme lisible : « PC1>SW1 ARP Request ». */
export function sends(events, sim) {
  const name = (id) => sim.device(id).name;
  return events
    .filter((event) => event.topic === Topics.PACKET_SEND)
    .map((event) => `${name(event.from)}>${name(event.to)} ${event.packet.label}`);
}

/** Les clés de toutes les explications publiées, dans l'ordre. */
export function noteKeys(events) {
  return events.flatMap((event) => (event.notes || []).map((n) => n.key));
}
