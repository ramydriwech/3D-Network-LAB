// Façade de la simulation : le seul point d'entrée utilisé par main.js, l'interface et
// le rendu 3D. Elle assemble le moteur, le bus d'évènements, les commandes, le registre
// des protocoles et le réseau simulé.
//
//   const sim = createSimulation();
//   await sim.loadScenarioFromUrl('scenarios/ping.json');
//   sim.on('packet:send', (event) => …);   // s'abonner (patron Observer)
//   sim.execute('play');                    // commander (patron Command)
//   sim.tick(dtMs);                         // à chaque image

import { Topics } from './src/sim/events.js';
import { Engine, SPEEDS } from './src/sim/engine.js';
import { createCommands } from './src/sim/commands.js';
import { ProtocolRegistry } from './src/sim/registry.js';
import { fetchScenario, validateScenario } from './src/sim/scenario.js';
import { EventBus } from './src/sim/eventBus.js';
import { Network, CORE_TEXTS } from './src/sim/network.js';
import { loadDeviceTypes } from './src/sim/network.js';

export { Topics, SPEEDS };

/** Pause entre deux étapes d'un scénario (ms simulées). */
const STEP_GAP = 600;

export function createSimulation() {
  const bus = new EventBus();
  const engine = new Engine(bus);
  const registry = new ProtocolRegistry();
  const commands = createCommands(engine);
  registry.addTexts(CORE_TEXTS);
  let deviceTypes = {};
  let customSteps = null; // étapes lancées à la main (ex. ping entre deux hôtes choisis)
  let stepIndex = 0;

  const sim = {
    bus,
    engine,
    registry,
    commands,
    scenario: null,
    network: null,

    get state() { return engine.state; },
    get now() { return engine.now; },
    get speed() { return engine.speed; },

    /** S'abonner à un sujet du bus ; retourne la fonction de désabonnement. */
    on(topic, listener) { return bus.on(topic, listener); },

    /** Exécute une commande : 'play', 'pause', 'step', 'speed' (avec valeur), 'reset'. */
    execute(name, argument) {
      const command = commands[name];
      if (!command) throw new Error(`Commande inconnue : ${name}`);
      return command.execute(argument);
    },

    can(name) { return !!commands[name] && commands[name].canExecute(); },

    /** À appeler à chaque image avec le temps réel écoulé en millisecondes. */
    tick(realDtMs) { engine.tick(realDtMs); },

    /** Charge un scénario déjà lu (objet JSON). */
    async loadScenario(scenario) {
      const { ok, errors } = validateScenario(scenario);
      if (!ok) throw new Error('Scénario invalide :\n- ' + errors.join('\n- '));
      await registry.load(scenario.protocols || []);
      deviceTypes = await loadDeviceTypes(scenario.devices.map((device) => device.type), registry);
      sim.scenario = scenario;
      customSteps = null;
      engine.reset();
      bus.emit(Topics.SCENARIO_LOADED, { scenario });
      return scenario;
    },

    async loadScenarioFromUrl(url, fetchImpl) {
      return sim.loadScenario(await fetchScenario(url, fetchImpl));
    },

    /** Texte { fr, en } d'une clé d'explication : le scénario peut redéfinir un texte. */
    text(key) {
      const own = sim.scenario && sim.scenario.explanations && sim.scenario.explanations[key];
      return own || registry.text(key);
    },

    /** Équipement simulé (état vivant : adresses, tables), ou null. */
    device(id) { return sim.network ? sim.network.device(id) : null; },

    /**
     * Trafic en cours : { now, links: { id: { ab, ba, max, speed, frames, lost } },
     * ports: { 'equipement:interface': { tx, rx (bit/s réels), txBytes, …, queue } } }.
     */
    traffic() { return sim.network ? sim.network.trafficSnapshot() : null; },

    /** Lien simulé (vitesse négociée, câble, ce qui limite), ou null. */
    link(id) { return sim.network ? sim.network.links.get(id) || null : null; },

    /** Étapes en cours : celles du scénario, ou une action lancée à la main. */
    steps() { return customSteps || (sim.scenario ? sim.scenario.steps : []); },

    /**
     * Rejoue la topologie depuis zéro avec une seule action choisie par l'utilisateur
     * (ex. { action: 'ping', from: 'pc1', to: 'pc3' }) puis lance la lecture.
     */
    runAction(step) {
      customSteps = [step];
      engine.reset();
      return engine.play();
    },

    /**
     * Comme runAction, avec plusieurs étapes jouées l'une après l'autre (ex. les sondes d'un
     * traceroute lancé depuis une console : les caches ARP restent remplis entre elles).
     */
    runActions(steps) {
      customSteps = [...steps];
      engine.reset();
      return engine.play();
    },

    /** Vrai si une action lancée à la main remplace les étapes du scénario. */
    isCustom() { return customSteps !== null; },

    /** Revient aux étapes prévues par le scénario. */
    restoreScenario() {
      customSteps = null;
      engine.reset();
    },
  };

  function scheduleStep(delay) {
    const steps = sim.steps();
    if (stepIndex >= steps.length) return false;
    const index = stepIndex++;
    engine.schedule(delay, () => {
      bus.emit(Topics.STEP, { index, step: steps[index] });
      sim.network.runAction(steps[index]);
    });
    return true;
  }

  // À chaque réinitialisation, le réseau est reconstruit : tables et caches repartent vides.
  engine.onReset = () => {
    if (!sim.scenario) return;
    sim.network = new Network({ scenario: sim.scenario, engine, bus, registry, deviceTypes });
    stepIndex = 0;
    scheduleStep(0);
  };

  // Quand plus rien ne circule, l'étape suivante du scénario démarre.
  engine.onIdle = () => scheduleStep(STEP_GAP);

  return sim;
}
