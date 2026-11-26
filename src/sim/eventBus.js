// Bus d'évènements (patron Observer). La simulation publie ce qui se passe ; l'interface
// et le rendu 3D s'abonnent. Personne ne s'appelle directement : chaque partie peut
// être développée et testée seule.

export class EventBus {
  constructor() {
    this.listeners = new Map(); // sujet -> Set de fonctions
  }

  /** Abonne `listener` au sujet `topic` ('*' = tous). Retourne la fonction de désabonnement. */
  on(topic, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener doit être une fonction');
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(listener);
    return () => this.off(topic, listener);
  }

  /** Abonnement qui se retire après le premier évènement. */
  once(topic, listener) {
    const off = this.on(topic, (payload, name) => {
      off();
      listener(payload, name);
    });
    return off;
  }

  off(topic, listener) {
    const set = this.listeners.get(topic);
    if (set) set.delete(listener);
  }

  /**
   * Publie un évènement. Les abonnés sont appelés dans l'ordre d'abonnement.
   * Règle métier : une erreur chez un abonné ne doit jamais arrêter la simulation ;
   * elle est signalée dans la console et les autres abonnés sont quand même prévenus.
   */
  emit(topic, payload = {}) {
    for (const name of [topic, '*']) {
      const set = this.listeners.get(name);
      if (!set) continue;
      for (const listener of [...set]) {
        try {
          listener(payload, topic);
        } catch (error) {
          console.error(`[bus] erreur dans un abonné de « ${topic} »`, error);
        }
      }
    }
  }

  count(topic) {
    const set = this.listeners.get(topic);
    return set ? set.size : 0;
  }
}
