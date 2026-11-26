// Moteur à évènements discrets.
//
// Principe : la simulation est une file d'évènements triée par date (temps simulé, en ms).
// L'horloge saute d'évènement en évènement ; elle ne dépend pas du nombre d'images par
// seconde. Le rendu 3D se contente de lire `engine.now` pour placer les paquets.
// Conséquence : la même suite d'actions donne toujours la même suite d'évènements,
// ce qui rend les scénarios testables sans navigateur.

import { Topics } from './events.js';
import { EventBus } from './eventBus.js';
import { SimState, StateMachine } from './state.js';

export { SimState };
// ×0,25 : pour suivre trame par trame une file d'attente ou une retransmission.
export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4]);

/** Garde-fou contre un protocole qui se répondrait à lui-même sans fin. */
const MAX_EVENTS_PER_ADVANCE = 100000;

export class Engine {
  constructor(bus = new EventBus()) {
    this.bus = bus;
    this.machine = new StateMachine(bus);
    this.queue = [];       // évènements triés par (time, id)
    this.nextId = 0;
    this.now = 0;          // horloge simulée (ms)
    this.speed = 1;
    this.stepping = false; // vrai pendant un « pas à pas »
    /** Appelé quand la file est vide ; retourne true s'il a programmé une suite. */
    this.onIdle = null;
    /** Appelé pendant reset(), avant l'annonce aux abonnés. */
    this.onReset = null;
  }

  get state() { return this.machine.state; }
  can(command) { return this.machine.can(command); }
  pending() { return this.queue.length; }

  /**
   * Programme `run` dans `delay` ms de temps simulé.
   * `boundary: true` marque une fin d'étape visible (l'arrivée d'un paquet) : c'est là
   * que le pas à pas s'arrête.
   * @returns {number} identifiant, utilisable avec cancel()
   */
  schedule(delay, run, { boundary = false } = {}) {
    const event = { id: ++this.nextId, time: this.now + Math.max(0, delay), run, boundary };
    // Insertion triée : à date égale, l'ordre de programmation est conservé (déterminisme).
    let low = 0;
    let high = this.queue.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.queue[middle].time <= event.time) low = middle + 1;
      else high = middle;
    }
    this.queue.splice(low, 0, event);
    return event.id;
  }

  /** Annule un évènement programmé (ex. un délai d'attente devenu inutile). */
  cancel(id) {
    const index = this.queue.findIndex((event) => event.id === id);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  play() {
    if (!this.can('play')) return false;
    this.stepping = false;
    this.machine.to(SimState.PLAYING);
    return true;
  }

  pause() {
    if (!this.can('pause')) return false;
    this.stepping = false;
    this.machine.to(SimState.PAUSED);
    return true;
  }

  /**
   * Pas à pas : la lecture reprend jusqu'à la prochaine arrivée de paquet, puis se met
   * en pause toute seule. Avec `instant: true`, le saut est immédiat (tests, panneau VR).
   */
  step({ instant = false } = {}) {
    if (!this.can('step')) return false;
    this.stepping = true;
    this.machine.to(SimState.PLAYING);
    if (instant) this.advance(Infinity);
    return true;
  }

  setSpeed(speed) {
    if (!(speed > 0) || !Number.isFinite(speed)) return false;
    this.speed = speed;
    this.bus.emit(Topics.SPEED, { speed });
    return true;
  }

  reset() {
    this.queue = [];
    this.now = 0;
    this.stepping = false;
    this.machine.reset();
    if (this.onReset) this.onReset();
    this.bus.emit(Topics.RESET, {});
    this.bus.emit(Topics.CLOCK, { now: 0 });
    return true;
  }

  /** Appelé à chaque image avec le temps réel écoulé ; la vitesse s'applique ici. */
  tick(realDtMs) {
    if (this.state !== SimState.PLAYING) return;
    this.advance(realDtMs * this.speed);
  }

  /** Lit le scénario d'une traite jusqu'à la fin (tests). */
  runToEnd() {
    if (this.can('play')) this.play();
    this.advance(Infinity);
  }

  /** Avance l'horloge de `simDt` ms en traitant, dans l'ordre, tous les évènements échus. */
  advance(simDt) {
    if (this.state !== SimState.PLAYING) return;
    const target = this.now + simDt;
    let processed = 0;
    while (this.state === SimState.PLAYING) {
      if (this.queue.length === 0 && !this._askForMore()) {
        this._finish();
        break;
      }
      if (this.queue[0].time > target) {
        this.now = target;
        break;
      }
      this.now = this.queue[0].time;
      let boundary = false;
      // Tous les évènements de la même date forment un seul instant simulé.
      while (this.queue.length && this.queue[0].time <= this.now) {
        const event = this.queue.shift();
        boundary = boundary || event.boundary;
        event.run(this);
        if (++processed > MAX_EVENTS_PER_ADVANCE) throw new Error('Simulation emballée : trop d\'évènements');
      }
      if (boundary && this.stepping && this.state === SimState.PLAYING) {
        this.stepping = false;
        if (this.queue.length === 0 && !this._askForMore()) this._finish();
        else this.machine.to(SimState.PAUSED);
        break;
      }
    }
    this.bus.emit(Topics.CLOCK, { now: this.now });
  }

  _askForMore() {
    return !!(this.onIdle && this.onIdle() === true && this.queue.length > 0);
  }

  _finish() {
    this.stepping = false;
    this.machine.to(SimState.FINISHED);
    this.bus.emit(Topics.FINISHED, { now: this.now });
  }
}
