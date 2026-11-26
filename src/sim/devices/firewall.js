// Pare-feu à états (laboratoire de Steve, S6).
//
// Un pare-feu est un routeur qui décide en plus de ce qui a le droit de passer. Chaque
// interface appartient à une ZONE avec un NIVEAU DE SÉCURITÉ (comme sur les pare-feu
// d'entreprise) : inside = 100 (le réseau interne), dmz = 50 (les serveurs publics),
// outside = 0 (Internet). La politique par défaut est simple :
//
//   1. d'une zone plus sûre vers une zone moins sûre (inside → outside) : autorisé, et le
//      pare-feu NOTE la session ;
//   2. une réponse qui appartient à une session notée : autorisée (pare-feu « à états ») ;
//   3. d'une zone moins sûre vers une plus sûre (outside → inside) : REFUSÉ, sauf si une
//      liste d'accès placée en entrée sur l'interface l'autorise explicitement ;
//   4. entre deux interfaces du même niveau : refusé.
//
// Les listes d'accès et le NAT fonctionnent comme sur un routeur (classe Router).

import { Router, texts as routerTexts } from './router.js';
import { note } from '../events.js';
import { flowKey, replyKey } from '../security.js';

/** Niveau de sécurité par défaut de chaque zone. */
export const ZONE_LEVELS = Object.freeze({ inside: 100, dmz: 50, outside: 0 });

export const texts = {
  ...routerTexts,
  'fw.session': {
    fr: '{name} (pare-feu) : {from} ({lin}) → {to} ({lout}), d\'une zone plus sûre vers une moins sûre : autorisé. La session est notée pour laisser revenir la réponse.',
    en: '{name} (firewall): {from} ({lin}) → {to} ({lout}), from a more trusted zone to a less trusted one: allowed. The session is recorded so the reply can come back.',
  },
  'fw.return': {
    fr: '{name} (pare-feu) : ce paquet appartient à une session déjà autorisée (c\'est une réponse) : il passe sans nouveau contrôle.',
    en: '{name} (firewall): this packet belongs to an already allowed session (it is a reply): it passes without a new check.',
  },
  'fw.acl': {
    fr: '{name} (pare-feu) : trafic de {from} ({lin}) vers {to} ({lout}) autorisé par une règle explicite de la liste d\'accès d\'entrée.',
    en: '{name} (firewall): traffic from {from} ({lin}) to {to} ({lout}) allowed by an explicit rule of the inbound access list.',
  },
  'fw.block': {
    fr: '{name} (pare-feu) BLOQUE ce paquet : il va de {from} ({lin}) vers {to} ({lout}), d\'une zone moins sûre vers une plus sûre, et aucune règle ne l\'autorise. C\'est le comportement voulu : Internet ne peut pas ouvrir de connexion vers le réseau interne.',
    en: '{name} (firewall) BLOCKS this packet: it goes from {from} ({lin}) to {to} ({lout}), from a less trusted zone to a more trusted one, and no rule allows it. This is intended: the Internet cannot open connections into the internal network.',
  },
  'fw.sameLevel': {
    fr: '{name} (pare-feu) BLOQUE ce paquet : {lin} et {lout} ont le même niveau de sécurité ({level}).',
    en: '{name} (firewall) BLOCKS this packet: {lin} and {lout} have the same security level ({level}).',
  },
};

export class Firewall extends Router {
  constructor(def, net) {
    super(def, net);
    this.sessions = new Map(); // clé du flux retour -> { from, to, proto, hits }
  }

  /** Niveau de sécurité d'une interface : réglé, ou déduit de sa zone. */
  levelOf(iface) {
    if (iface.level != null) return iface.level;
    return ZONE_LEVELS[iface.zone] != null ? ZONE_LEVELS[iface.zone] : 0;
  }

  zoneLabel(iface) {
    return `${iface.zone || iface.name}, ${this.levelOf(iface)}`;
  }

  isReturn(packet) {
    return this.sessions.has(flowKey(packet));
  }

  allowForward(packet, inIface, outIface) {
    const params = {
      name: this.name, from: packet.ip.src, to: packet.ip.dst,
      lin: this.zoneLabel(inIface), lout: this.zoneLabel(outIface),
    };
    const session = this.sessions.get(flowKey(packet));
    if (session) {
      session.hits += 1;
      return { allow: true, notes: [note('fw.return', params)] };
    }
    const lin = this.levelOf(inIface);
    const lout = this.levelOf(outIface);
    let verdict;
    if (packet.aclPermitted) verdict = 'fw.acl';
    else if (lin > lout) verdict = 'fw.session';
    else if (lin === lout) return { allow: false, notes: [note('fw.sameLevel', { ...params, level: lin })] };
    else return { allow: false, notes: [note('fw.block', params)] };
    this.sessions.set(replyKey(packet), { from: packet.ip.src, to: packet.ip.dst, proto: packet.ip.proto, hits: 1 });
    this.net.update(this, 'sessions');
    return { allow: true, notes: [note(verdict, params)] };
  }

  tables() {
    return [
      {
        id: 'zones',
        title: { fr: 'Zones du pare-feu', en: 'Firewall zones' },
        columns: [{ fr: 'Interface', en: 'Interface' }, { fr: 'Zone', en: 'Zone' }, { fr: 'Niveau', en: 'Level' }],
        rows: this.interfaces.filter((iface) => iface.ip).map((iface) => [iface.name, iface.zone || '—', String(this.levelOf(iface))]),
      },
      {
        id: 'sessions',
        title: { fr: 'Sessions ouvertes', en: 'Open sessions' },
        columns: [{ fr: 'De', en: 'From' }, { fr: 'Vers', en: 'To' }, { fr: 'Protocole', en: 'Protocol' }],
        rows: [...this.sessions.values()].map((s) => [s.from, s.to, s.proto]),
      },
      ...super.tables(),
    ];
  }
}

export function create(def, net) {
  return new Firewall(def, net);
}
