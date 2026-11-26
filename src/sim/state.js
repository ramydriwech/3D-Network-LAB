// États de la simulation (patron State) : prêt, lecture, pause, terminé.
// La machine refuse les transitions interdites ; l'interface s'en sert pour activer
// ou griser les boutons.

import { Topics } from './events.js';

export const SimState = Object.freeze({
  READY: 'ready',       // prêt
  PLAYING: 'playing',   // lecture
  PAUSED: 'paused',     // pause
  FINISHED: 'finished', // terminé
});

/** Transitions autorisées (la réinitialisation, toujours permise, est traitée à part). */
const TRANSITIONS = Object.freeze({
  [SimState.READY]: [SimState.PLAYING],
  [SimState.PLAYING]: [SimState.PAUSED, SimState.FINISHED],
  [SimState.PAUSED]: [SimState.PLAYING],
  [SimState.FINISHED]: [],
});

/** États dans lesquels chaque commande est disponible. */
const AVAILABLE = Object.freeze({
  play: [SimState.READY, SimState.PAUSED],
  pause: [SimState.PLAYING],
  step: [SimState.READY, SimState.PAUSED],
  speed: Object.values(SimState),
  reset: Object.values(SimState),
});

export class StateMachine {
  constructor(bus) {
    this.bus = bus;
    this.state = SimState.READY;
  }

  /** La commande est-elle autorisée dans l'état courant ? */
  can(command) {
    return (AVAILABLE[command] || []).includes(this.state);
  }

  canGo(next) {
    return TRANSITIONS[this.state].includes(next);
  }

  /** Change d'état et prévient les abonnés ; lève une erreur si la transition est interdite. */
  to(next) {
    if (next === this.state) return;
    if (!this.canGo(next)) throw new Error(`Transition interdite : ${this.state} -> ${next}`);
    this._set(next);
  }

  /** Retour à l'état prêt, autorisé depuis n'importe quel état. */
  reset() {
    this._set(SimState.READY);
  }

  _set(next) {
    const previous = this.state;
    this.state = next;
    if (this.bus && previous !== next) this.bus.emit(Topics.STATE, { state: next, previous });
  }
}
