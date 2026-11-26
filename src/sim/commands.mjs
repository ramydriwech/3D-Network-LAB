// Commandes de la simulation (patron Command). Chaque action de l'utilisateur est un
// objet avec deux méthodes : canExecute() (le bouton doit-il être actif ?) et execute().
// Les boutons HTML, le clavier et le panneau VR partagent ainsi exactement la même logique.

export const COMMAND_NAMES = Object.freeze(['play', 'pause', 'step', 'speed', 'reset']);

class Command {
  constructor(engine, name) {
    this.engine = engine;
    this.name = name;
  }
  canExecute() { return this.engine.can(this.name); }
}

/** Lecture : le temps simulé avance. */
export class PlayCommand extends Command {
  constructor(engine) { super(engine, 'play'); }
  execute() { return this.canExecute() && this.engine.play(); }
}

/** Pause : le temps simulé se fige, les paquets restent où ils sont. */
export class PauseCommand extends Command {
  constructor(engine) { super(engine, 'pause'); }
  execute() { return this.canExecute() && this.engine.pause(); }
}

/** Pas à pas : avance jusqu'à la prochaine réception d'un paquet, puis se remet en pause. */
export class StepCommand extends Command {
  constructor(engine) { super(engine, 'step'); }
  execute(options) { return this.canExecute() && this.engine.step(options); }
}

/** Vitesse : facteur appliqué au temps simulé (0.5, 1, 2, 4). */
export class SpeedCommand extends Command {
  constructor(engine) { super(engine, 'speed'); }
  execute(speed) { return this.canExecute() && this.engine.setSpeed(Number(speed)); }
}

/** Réinitialisation : retour au début du scénario, tables des équipements vidées. */
export class ResetCommand extends Command {
  constructor(engine) { super(engine, 'reset'); }
  execute() { return this.engine.reset(); }
}

/** Bascule lecture/pause (touche Espace, bouton unique du panneau VR). */
export class ToggleCommand extends Command {
  constructor(engine) { super(engine, 'toggle'); }
  canExecute() { return this.engine.can('play') || this.engine.can('pause'); }
  execute() {
    if (this.engine.can('pause')) return this.engine.pause();
    return this.engine.can('play') && this.engine.play();
  }
}

/** Crée le jeu de commandes relié à un moteur (réel ou mock : même interface). */
export function createCommands(engine) {
  return {
    play: new PlayCommand(engine),
    pause: new PauseCommand(engine),
    step: new StepCommand(engine),
    speed: new SpeedCommand(engine),
    reset: new ResetCommand(engine),
    toggle: new ToggleCommand(engine),
  };
}
