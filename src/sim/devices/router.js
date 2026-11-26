// Comportement d'un routeur : il relie plusieurs réseaux IP et relaie les paquets
// d'une interface à l'autre.
//
// Routage statique : la table contient les réseaux directement connectés et les routes
// écrites dans le scénario (« routes »: [{ network, prefix, via }]). À chaque passage,
// le TTL diminue de 1 ; à zéro, le paquet est détruit et la source est prévenue par ICMP.
//
// Simplifications pédagogiques : pas de protocole de routage dynamique, pas de
// fragmentation, pas de redirection ICMP.

import { IpNode, texts as hostTexts } from './host.js';
import { note } from '../events.js';
import { NatTable, evaluateAcl, ruleText } from '../security.js';

export const texts = {
  ...hostTexts,
  'router.lookup': {
    fr: '{name} consulte sa table de routage : {dst} appartient à {network}/{prefix}, sortie par {iface} ({how}).',
    en: '{name} looks up its routing table: {dst} belongs to {network}/{prefix}, exit through {iface} ({how}).',
  },
  'router.forward': {
    fr: '{name} relaie le paquet : nouvelles adresses MAC (source {srcMac}, destination {dstMac}), adresses IP inchangées.',
    en: '{name} forwards the packet: new MAC addresses (source {srcMac}, destination {dstMac}), IP addresses unchanged.',
  },
  'router.noRoute': {
    fr: '{name} n\'a aucune route vers {dst} : le paquet est détruit.',
    en: '{name} has no route to {dst}: the packet is discarded.',
  },
  'router.ttl': {
    fr: '{name} diminue le TTL de {before} à {after} avant de relayer.',
    en: '{name} decrements the TTL from {before} to {after} before forwarding.',
  },
  'router.ttlExpired': {
    fr: '{name} : le TTL arrive à 0, le paquet est détruit pour éviter qu\'il tourne sans fin. La source est prévenue par un message ICMP « Time Exceeded ».',
    en: '{name}: the TTL reaches 0, the packet is discarded so it cannot loop forever. The source is told with an ICMP "Time Exceeded" message.',
  },
  'acl.deny': {
    fr: '{name} : la liste d\'accès {acl} ({dir} sur {iface}) REFUSE ce paquet — {rule}. Il est détruit.',
    en: '{name}: access list {acl} ({dir} on {iface}) DENIES this packet — {rule}. It is discarded.',
  },
  'acl.permit': {
    fr: '{name} : la liste d\'accès {acl} ({dir} sur {iface}) autorise ce paquet — {rule}.',
    en: '{name}: access list {acl} ({dir} on {iface}) permits this packet — {rule}.',
  },
  'nat.out': {
    fr: '{name} traduit l\'adresse source (NAT) : {inside} devient {outside}. Une adresse privée ne circule jamais sur Internet ; la table NAT retiendra à qui rendre la réponse.',
    en: '{name} translates the source address (NAT): {inside} becomes {outside}. A private address never travels on the Internet; the NAT table will remember who gets the reply.',
  },
  'nat.in': {
    fr: '{name} retrouve la traduction dans sa table NAT : l\'adresse publique {outside} redevient {inside}, le paquet est remis au bon équipement.',
    en: '{name} finds the translation in its NAT table: public address {outside} becomes {inside} again, the packet goes to the right device.',
  },
};

export class Router extends IpNode {
  constructor(def, net) {
    super(def, net);
    this.forwarding = true;
    this.staticRoutes = (def.routes || []).map((route) => ({ ...route, iface: null, kind: 'static' }));
    this.acls = def.acls || {};          // nom -> liste de règles
    this.aclHits = new Map();            // nom -> compteurs par règle
    this.nat = new NatTable(def.nat || []);
  }

  /** Applique la liste d'accès `name` ; compte les correspondances, comme « show access-lists ». */
  checkAcl(name, packet, dir, iface) {
    if (!name) return { permit: true, note: null };
    const rules = this.acls[name];
    if (!rules) return { permit: true, note: null }; // liste absente : rien n'est filtré (comme sur un vrai routeur)
    const verdict = evaluateAcl(rules, packet);
    if (!this.aclHits.has(name)) this.aclHits.set(name, rules.map(() => 0));
    if (verdict.index >= 0) this.aclHits.get(name)[verdict.index] += 1;
    const params = {
      name: this.name, acl: name, iface: iface.name,
      dir: dir === 'in' ? { fr: 'en entrée', en: 'inbound' } : { fr: 'en sortie', en: 'outbound' },
      rule: verdict.rule ? ruleText(verdict.rule) : { fr: 'aucune règle ne correspond : refus implicite final', en: 'no rule matches: final implicit deny' },
    };
    return { permit: verdict.permit, explicit: verdict.index >= 0, note: note(verdict.permit ? 'acl.permit' : 'acl.deny', params) };
  }

  /**
   * Contrôles d'entrée (appelés par IpNode.receive) : NAT retour d'abord, pour que la liste
   * d'accès d'entrée raisonne sur les vraies adresses (comme les pare-feu récents), puis ACL.
   */
  filterIn(packet, iface) {
    const notes = [];
    if (iface.nat === 'outside' && this.nat.rules.length) {
      const back = this.nat.translateIn(packet);
      if (back) {
        notes.push(note('nat.in', { name: this.name, outside: packet.ip.dst, inside: back.ip.dst }));
        packet = { ...packet, ip: { ...packet.ip, ...back.ip }, ...(back.tcp ? { tcp: back.tcp } : {}), ...(back.udp ? { udp: back.udp } : {}), ...(back.icmp ? { icmp: back.icmp } : {}) };
        this.net.update(this, 'nat');
      }
    }
    // Pare-feu à états : la réponse d'une session déjà autorisée n'est pas refiltrée.
    if (this.isReturn(packet)) return { packet: { ...packet, filterNotes: notes, aclPermitted: false } };
    const acl = this.checkAcl(iface.acl && iface.acl.in, packet, 'in', iface);
    if (!acl.permit) {
      this.net.drop(this, packet, [...notes, acl.note]);
      return { result: { accepted: true, notes: [...notes, acl.note] } };
    }
    if (acl.note) notes.push(acl.note);
    // Copie : la même trame peut avoir été recopiée vers d'autres équipements.
    return { packet: { ...packet, filterNotes: notes, aclPermitted: acl.explicit === true } };
  }

  /** Le pare-feu redéfinit cette méthode ; un routeur relaie tout ce qu'il sait router. */
  allowForward() {
    return { allow: true, notes: [] };
  }

  /** Réponse d'une session connue ? (seul un pare-feu à états garde des sessions) */
  isReturn() {
    return false;
  }

  /** Adresse publique d'un NAT statique, sur l'interface extérieure : on y répond en ARP. */
  proxyArp(ip, iface) {
    return iface.nat === 'outside' && this.nat.rules.some((rule) => rule.type === 'static' && rule.outside === ip);
  }

  /** Réseaux connectés, puis routes statiques, puis route par défaut. */
  routes() {
    const base = super.routes();
    const connected = base.filter((route) => route.kind === 'connected');
    const fallback = base.filter((route) => route.kind === 'default');
    return [...connected, ...this.staticRoutes, ...fallback];
  }

  /** Relaie un paquet IP qui ne nous est pas destiné. */
  forward(packet, inIface) {
    const dst = packet.ip.dst;
    // Règle métier : un paquet dont le TTL tomberait à 0 n'est jamais relayé.
    if (packet.ip.ttl <= 1) {
      this.net.drop(this, packet, [note('router.ttlExpired', { name: this.name })]);
      const icmp = this.net.registry.get('icmp');
      if (icmp && icmp.error) icmp.error(this, packet, 'ttl', inIface);
      return { accepted: true, notes: [note('router.ttlExpired', { name: this.name })] };
    }
    const hop = this.lookup(dst);
    if (!hop) {
      this.net.drop(this, packet, [note('router.noRoute', { name: this.name, dst })]);
      const icmp = this.net.registry.get('icmp');
      if (icmp && icmp.error) icmp.error(this, packet, 'net', inIface);
      return { accepted: true, notes: [note('router.noRoute', { name: this.name, dst })] };
    }
    const how = hop.route.via
      ? { fr: `prochain saut ${hop.route.via}`, en: `next hop ${hop.route.via}` }
      : { fr: 'réseau directement connecté', en: 'directly connected network' };
    const lookup = note('router.lookup', {
      name: this.name, dst, network: hop.route.network, prefix: hop.route.prefix, iface: hop.iface.name, how,
    });
    // Pare-feu (politique), ACL de sortie, puis traduction d'adresse vers l'extérieur.
    const policy = this.allowForward(packet, inIface, hop.iface);
    if (!policy.allow) {
      this.net.drop(this, packet, policy.notes);
      return { accepted: true, notes: [lookup, ...policy.notes] };
    }
    const out = this.checkAcl(hop.iface.acl && hop.iface.acl.out, packet, 'out', hop.iface);
    if (!out.permit) {
      this.net.drop(this, packet, [out.note]);
      return { accepted: true, notes: [lookup, out.note] };
    }
    const extra = [...(packet.filterNotes || []), ...policy.notes, ...(out.note ? [out.note] : [])];
    let rewrite = {};
    if (inIface.nat === 'inside' && hop.iface.nat === 'outside' && this.nat.rules.length) {
      const translated = this.nat.translateOut(packet, hop.iface.ip, this.acls);
      if (translated) {
        const { entry, ...fields } = translated;
        rewrite = fields;
        extra.push(note('nat.out', { name: this.name, inside: `${packet.ip.src}`, outside: `${entry.outside}${entry.outsidePort != null && entry.kind !== 'static' ? ':' + entry.outsidePort : ''}` }));
        this.net.update(this, 'nat');
      }
    }
    const ttl = packet.ip.ttl - 1;
    const notes = [note('router.ttl', { name: this.name, before: packet.ip.ttl, after: ttl })];
    const { ip: ipRewrite = {}, ...layers } = rewrite;
    this.output(
      hop,
      // La trame repart sans étiquette VLAN : c'est la sous-interface de sortie qui en remettra une.
      (mac) => this.net.clone(packet, { ...layers, vlan: undefined, filterNotes: undefined, aclPermitted: undefined, eth: { src: hop.iface.mac, dst: mac, type: 'IPv4' }, ip: { ttl, ...ipRewrite } }),
      (mac) => [lookup, ...extra, ...notes, note('router.forward', { name: this.name, srcMac: hop.iface.mac, dstMac: mac })],
    );
    return { accepted: true, notes: [lookup] };
  }

  tables() {
    const extra = [];
    for (const [name, rules] of Object.entries(this.acls)) {
      const hits = this.aclHits.get(name) || [];
      extra.push({
        id: `acl-${name}`,
        title: { fr: `Liste d'accès ${name}`, en: `Access list ${name}` },
        columns: [{ fr: 'Règle', en: 'Rule' }, { fr: 'Correspondances', en: 'Matches' }],
        rows: rules.map((rule, i) => [ruleText(rule), String(hits[i] || 0)]),
      });
    }
    if (this.nat.entries.length) {
      extra.push({
        id: 'nat',
        title: { fr: 'Traductions NAT', en: 'NAT translations' },
        columns: [{ fr: 'Intérieur', en: 'Inside' }, { fr: 'Extérieur', en: 'Outside' }, { fr: 'Destinataire', en: 'Remote' }],
        rows: this.nat.entries.map((e) => [`${e.inside}${e.insidePort != null ? ':' + e.insidePort : ''}`, `${e.outside}${e.outsidePort != null ? ':' + e.outsidePort : ''}`, e.remote]),
      });
    }
    return [
      {
        id: 'routes',
        title: { fr: 'Table de routage', en: 'Routing table' },
        columns: [{ fr: 'Réseau', en: 'Network' }, { fr: 'Prochain saut', en: 'Next hop' }, { fr: 'Interface', en: 'Interface' }],
        rows: this.routeRows(),
      },
      ...extra,
      ...super.tables(),
    ];
  }
}

export function create(def, net) {
  return new Router(def, net);
}
