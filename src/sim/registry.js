// Registre des protocoles (patron Strategy) : la simulation choisit la logique à
// appliquer d'après l'identifiant du protocole, sans connaître son code.
// Les protocoles sont chargés à la demande depuis src/sim/protocols/<id>.js : ajouter
// un protocole = ajouter un fichier, sans toucher à ce registre.

import { validateProtocol } from './events.js';

const defaultImporter = (id) => import(new URL(`./protocols/${id}.js`, import.meta.url).href);

export class ProtocolRegistry {
  constructor() {
    this.protocols = new Map();
    this.texts = {};
  }

  /** Enregistre un protocole après avoir vérifié qu'il respecte le contrat. */
  register(protocol) {
    const errors = validateProtocol(protocol);
    if (errors.length) throw new Error(`Protocole « ${protocol && protocol.id} » non conforme : ${errors.join(' ; ')}`);
    this.protocols.set(protocol.id, protocol);
    this.addTexts(protocol.texts);
    return protocol;
  }

  /** Ajoute des textes d'explication ({ clé: { fr, en } }). */
  addTexts(texts = {}) {
    Object.assign(this.texts, texts);
  }

  get(id) { return this.protocols.get(id) || null; }
  has(id) { return this.protocols.has(id); }
  all() { return [...this.protocols.values()]; }

  /** Protocole capable de lancer l'action de scénario demandée (ex. 'ping' -> ICMP). */
  actionOwner(action) {
    return this.all().find((protocol) => (protocol.actions || []).includes(action)) || null;
  }

  /** Charge les protocoles demandés et, avant eux, ceux dont ils dépendent. */
  async load(ids = [], importer = defaultImporter) {
    for (const id of ids) {
      if (this.has(id)) continue;
      const module = await importer(id);
      const protocol = module.default;
      await this.load((protocol && protocol.requires) || [], importer);
      this.register(protocol);
    }
  }

  /** Texte { fr, en } associé à une clé, ou null. */
  text(key) {
    return this.texts[key] || null;
  }
}
