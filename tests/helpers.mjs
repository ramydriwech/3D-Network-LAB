// Outils communs aux tests : charger un scénario depuis le disque et enregistrer ce que
// publie la simulation.

import { readFileSync } from 'node:fs';
import { createSimulation, Topics } from '../simulation.mjs';

export function readScenario(name) {
  return JSON.parse(readFileSync(new URL(`../scenarios/${name}.json`, import.meta.url), 'utf8'));
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
