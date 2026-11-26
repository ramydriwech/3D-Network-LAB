// Voyants des ports, pilotés par la simulation : ce qu'un étudiant verrait sur un vrai switch.
//
//   - voyant de LIEN : vert si un câble est branché et le lien négocié à 1 Gb/s ou plus,
//     orange en dessous (100 Mb/s : une carte ou le câble bride le lien), éteint sans câble ou
//     si le port est éteint (shutdown), orange clignotant si le port est bloqué (err-disabled) ;
//   - voyant d'ACTIVITÉ : clignote pendant qu'une trame part ou arrive sur ce port.
//
// La règle elle-même est dans deviceLayout.mjs (portLedState, testée sans navigateur). Ici, on
// suit les évènements de la simulation et on recolore les voyants (InstancedMesh construites
// par deviceModels.mjs). L'activité suit l'horloge SIMULÉE : en pause, les voyants se figent.

import * as THREE from 'three';
import { Topics } from '../sim/events.mjs';
import { portLedState, LED_COLORS } from './deviceLayout.mjs';

/** Fréquence de mise à jour (ms réelles) : largement assez pour l'œil. */
const REFRESH = 40;
/** Durée minimale (ms simulées) pendant laquelle le voyant d'activité reste animé. */
const MIN_ACTIVITY = 250;

const COLORS = Object.fromEntries(Object.entries(LED_COLORS).map(([name, hex]) => [name, new THREE.Color(hex)]));

export function createPortLeds(render, sim) {
  let ends = new Map();      // id du lien -> ['equipement:interface', 'equipement:interface']
  let cabled = new Map();    // 'equipement:interface' -> id du lien
  const activeUntil = new Map(); // 'equipement:interface' -> date simulée de fin d'activité
  const shown = new Map();   // mesh -> tableau des couleurs affichées (évite les mises à jour inutiles)
  let elapsed = REFRESH;
  let realClock = 0;

  function index(scenario) {
    ends = new Map();
    cabled = new Map();
    activeUntil.clear();
    shown.clear();
    for (const link of (scenario && scenario.links) || []) {
      ends.set(link.id, [link.a, link.b]);
      cabled.set(link.a, link.id);
      cabled.set(link.b, link.id);
    }
  }

  /** Une trame part sur un lien : les ports des deux extrémités s'animent pendant son passage. */
  function mark(linkId, until) {
    for (const key of ends.get(linkId) || []) {
      if ((activeUntil.get(key) || 0) < until) activeUntil.set(key, until);
    }
  }

  function setColor(mesh, colors, i, name) {
    if (colors[i] === name) return false;
    colors[i] = name;
    mesh.setColorAt(i, COLORS[name] || COLORS.off);
    return true;
  }

  function refresh() {
    const scenario = sim.scenario;
    if (!scenario) return;
    const now = sim.now;
    for (const def of scenario.devices) {
      const object = render.deviceObject(def.id);
      const leds = object && object.userData.leds;
      if (!leds) continue;
      const live = sim.device(def.id);
      if (!shown.has(leds.mesh)) shown.set(leds.mesh, []);
      const colors = shown.get(leds.mesh);
      let changed = false;
      for (const [port, slots] of Object.entries(leds.ports)) {
        const key = `${def.id}:${port}`;
        const linkId = cabled.get(key);
        const iface = live && live.iface ? live.iface(port) : null;
        const link = linkId ? sim.link(linkId) : null;
        const state = portLedState({
          cabled: !!linkId,
          shutdown: !!(iface && iface.shutdown),
          errDisabled: !!(iface && iface.errDisabled),
          speed: link ? link.speed : 1000,
          active: now < (activeUntil.get(key) || 0),
          simNow: now,
          realNow: realClock,
        });
        for (const i of slots.link) changed = setColor(leds.mesh, colors, i, state.link) || changed;
        for (const i of slots.act) changed = setColor(leds.mesh, colors, i, state.act) || changed;
      }
      if (changed) leds.mesh.instanceColor.needsUpdate = true;
    }
  }

  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => index(scenario));
  sim.on(Topics.RESET, () => { activeUntil.clear(); elapsed = REFRESH; });
  sim.on(Topics.PACKET_SEND, (event) => mark(event.linkId, event.time + Math.max(event.duration || 0, MIN_ACTIVITY)));
  render.onFrame((dt) => {
    realClock += dt;
    elapsed += dt;
    if (elapsed < REFRESH) return;
    elapsed = 0;
    refresh();
  });
  if (sim.scenario) index(sim.scenario);

  return {
    refresh,
    /** État affiché d'un port (pour les tests en navigateur et le débogage). */
    stateOf(deviceId, port) {
      const object = render.deviceObject(deviceId);
      const leds = object && object.userData.leds;
      const slots = leds && leds.ports[port];
      if (!slots) return null;
      const colors = shown.get(leds.mesh) || [];
      return { link: colors[slots.link[0]] || 'off', act: colors[slots.act[0]] || 'off' };
    },
  };
}
