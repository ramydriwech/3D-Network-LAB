// Sécurité et fonctions avancées des équipements (laboratoire de Steve, S6) :
//   - listes de contrôle d'accès (ACL) des routeurs et pare-feu ;
//   - traduction d'adresses (NAT statique et NAT « overload », aussi appelée PAT) ;
//   - sessions du pare-feu à états (ce qui est sorti peut revenir) ;
//   - sécurité des ports de switch (adresses MAC autorisées, apprentissage « sticky »).
//
// Ce module ne fait que des calculs : il ne connaît ni le moteur ni le rendu. Les
// équipements (router.js, firewall.js, switch.js) l'appellent au bon moment, et les
// commandes de console (cli.js) l'utilisent pour afficher et modifier la configuration.
//
// FORMAT D'UNE RÈGLE D'ACL (scénarios et console) :
//   { action: 'permit' | 'deny', proto: 'ip' | 'icmp' | 'tcp' | 'udp',
//     src: 'any' | 'host 10.0.0.5' | '10.0.0.0/24', dst: …, port?: 80 }
// La dernière règle implicite de toute liste refuse tout (« deny ip any any »).

import { inNetwork, isIp } from './addr.js';

/** Protocoles qu'une règle peut viser. */
export const ACL_PROTOCOLS = Object.freeze(['ip', 'icmp', 'tcp', 'udp']);

/** Lit une adresse de règle : 'any', 'host A', 'A/len' ou 'A' seul (= host). */
export function parseMatch(text) {
  const value = String(text == null ? 'any' : text).trim();
  if (value === 'any') return { any: true, text: 'any' };
  const host = /^host\s+(\S+)$/.exec(value);
  if (host && isIp(host[1])) return { network: host[1], prefix: 32, text: `host ${host[1]}` };
  const net = /^(\S+)\/(\d+)$/.exec(value);
  if (net && isIp(net[1]) && Number(net[2]) >= 0 && Number(net[2]) <= 32) {
    return { network: net[1], prefix: Number(net[2]), text: `${net[1]}/${net[2]}` };
  }
  if (isIp(value)) return { network: value, prefix: 32, text: `host ${value}` };
  return null;
}

/** Vérifie une règle ; retourne un message d'erreur ou null. */
export function checkRule(rule) {
  if (!rule || (rule.action !== 'permit' && rule.action !== 'deny')) return 'action : permit ou deny';
  if (!ACL_PROTOCOLS.includes(rule.proto || 'ip')) return `protocole : ${ACL_PROTOCOLS.join(', ')}`;
  if (!parseMatch(rule.src)) return `source « ${rule.src} » illisible`;
  if (!parseMatch(rule.dst)) return `destination « ${rule.dst} » illisible`;
  if (rule.port != null && !(Number.isInteger(rule.port) && rule.port > 0 && rule.port < 65536)) return 'port : 1 à 65535';
  if (rule.port != null && !['tcp', 'udp'].includes(rule.proto)) return 'un port ne se précise qu\'avec tcp ou udp';
  return null;
}

const addressMatches = (match, ip) => match.any || (ip && inNetwork(ip, match.network, match.prefix));

/** Le paquet IP correspond-il à la règle ? */
export function ruleMatches(rule, packet) {
  const proto = rule.proto || 'ip';
  const ip = packet.ip;
  if (!ip) return false;
  if (proto !== 'ip' && proto !== (ip.proto || '').toLowerCase()) return false;
  if (!addressMatches(parseMatch(rule.src), ip.src) || !addressMatches(parseMatch(rule.dst), ip.dst)) return false;
  if (rule.port != null) {
    const layer = packet.tcp || packet.udp;
    if (!layer || layer.dstPort !== rule.port) return false;
  }
  return true;
}

/**
 * Évalue une liste sur un paquet. Retourne la décision et la règle utilisée
 * (index -1 : la règle implicite finale qui refuse tout).
 * @returns {{ permit: boolean, index: number, rule: Object|null }}
 */
export function evaluateAcl(rules, packet) {
  for (const [index, rule] of (rules || []).entries()) {
    if (ruleMatches(rule, packet)) return { permit: rule.action === 'permit', index, rule };
  }
  return { permit: false, index: -1, rule: null };
}

/** Texte d'une règle, dans le style des consoles : « deny tcp any host 10.0.0.5 eq 80 ». */
export function ruleText(rule) {
  const port = rule.port != null ? ` eq ${rule.port}` : '';
  return `${rule.action} ${rule.proto || 'ip'} ${parseMatch(rule.src).text} ${parseMatch(rule.dst).text}${port}`;
}

/** Clé d'un flux (sens aller) : protocole, adresses et ports, ou identifiant ICMP. */
export function flowKey(packet) {
  const ip = packet.ip;
  const layer = packet.tcp || packet.udp;
  if (layer) return `${ip.proto}|${ip.src}:${layer.srcPort}|${ip.dst}:${layer.dstPort}`;
  if (packet.icmp && packet.icmp.id != null) return `ICMP|${ip.src}|${ip.dst}|${packet.icmp.id}`;
  return `${ip.proto}|${ip.src}|${ip.dst}`;
}

/** Clé du flux retour attendu pour un paquet aller. */
export function replyKey(packet) {
  const ip = packet.ip;
  const layer = packet.tcp || packet.udp;
  if (layer) return `${ip.proto}|${ip.dst}:${layer.dstPort}|${ip.src}:${layer.srcPort}`;
  if (packet.icmp && packet.icmp.id != null) return `ICMP|${ip.dst}|${ip.src}|${packet.icmp.id}`;
  return `${ip.proto}|${ip.dst}|${ip.src}`;
}

/**
 * Table de traduction d'adresses (NAT) d'un routeur ou d'un pare-feu.
 *
 * NAT statique : une adresse privée ↔ une adresse publique, dans les deux sens.
 * NAT overload (PAT) : toutes les adresses privées sortent avec l'adresse de l'interface
 * extérieure ; chaque flux reçoit un port public différent, ce qui permet de retrouver à
 * qui renvoyer la réponse.
 */
export class NatTable {
  constructor(rules = []) {
    this.rules = rules;
    this.entries = []; // { proto, inside, insidePort, outside, outsidePort, remote, hits, kind }
    this.nextPort = 20000;
  }

  /** Règle qui s'applique à un paquet sortant (source privée). */
  ruleFor(packet, acls = {}) {
    for (const rule of this.rules) {
      if (rule.type === 'static' && rule.inside === packet.ip.src) return rule;
      if (rule.type === 'overload') {
        if (!rule.acl) return rule;
        if (evaluateAcl(acls[rule.acl], packet).permit) return rule;
      }
    }
    return null;
  }

  /**
   * Traduit un paquet qui sort par l'interface extérieure `outsideIp`.
   * @returns {{ ip: Object, layer?: Object, icmp?: Object, entry: Object }|null}
   */
  translateOut(packet, outsideIp, acls) {
    const rule = this.ruleFor(packet, acls);
    if (!rule) return null;
    const proto = packet.ip.proto;
    const layerName = packet.tcp ? 'tcp' : packet.udp ? 'udp' : null;
    const layer = layerName ? packet[layerName] : null;
    const insidePort = layer ? layer.srcPort : packet.icmp ? packet.icmp.id : null;
    let entry = this.entries.find((e) => e.proto === proto && e.inside === packet.ip.src && e.insidePort === insidePort
      && (rule.type === 'static' || e.remote === packet.ip.dst));
    if (!entry) {
      const publicIp = rule.type === 'static' ? rule.outside : outsideIp;
      const outsidePort = rule.type === 'static' ? insidePort : this.nextPort++;
      entry = { proto, inside: packet.ip.src, insidePort, outside: publicIp, outsidePort, remote: packet.ip.dst, hits: 0, kind: rule.type };
      this.entries.push(entry);
    }
    entry.hits += 1;
    const result = { ip: { src: entry.outside }, entry };
    if (layer) result[layerName] = { ...layer, srcPort: entry.outsidePort };
    else if (packet.icmp && packet.icmp.id != null) result.icmp = { ...packet.icmp, id: entry.outsidePort };
    return result;
  }

  /**
   * Retrouve à qui appartient un paquet qui revient de l'extérieur.
   * @returns {{ ip: Object, layer?: Object, icmp?: Object, entry: Object }|null}
   */
  translateIn(packet) {
    const proto = packet.ip.proto;
    const layerName = packet.tcp ? 'tcp' : packet.udp ? 'udp' : null;
    const layer = layerName ? packet[layerName] : null;
    const port = layer ? layer.dstPort : packet.icmp ? packet.icmp.id : null;
    let entry = this.entries.find((e) => e.proto === proto && e.outside === packet.ip.dst && e.outsidePort === port);
    // NAT statique : une connexion entrante vers l'adresse publique est permise.
    if (!entry) {
      const rule = this.rules.find((r) => r.type === 'static' && r.outside === packet.ip.dst);
      if (!rule) return null;
      entry = { proto, inside: rule.inside, insidePort: port, outside: rule.outside, outsidePort: port, remote: packet.ip.src, hits: 0, kind: 'static' };
      this.entries.push(entry);
    }
    entry.hits += 1;
    const result = { ip: { dst: entry.inside }, entry };
    if (layer) result[layerName] = { ...layer, dstPort: entry.insidePort };
    else if (packet.icmp && packet.icmp.id != null) result.icmp = { ...packet.icmp, id: entry.insidePort };
    return result;
  }
}

/**
 * Sécurité d'un port de switch.
 * config : { maximum = 1, sticky = false, macs = [], violation = 'shutdown' | 'restrict' | 'protect' }
 */
export class PortSecurity {
  constructor(config = {}) {
    this.maximum = config.maximum || 1;
    this.sticky = config.sticky === true;
    this.violation = config.violation || 'shutdown';
    this.allowed = new Set((config.macs || []).map((mac) => mac.toUpperCase()));
    this.learned = new Set(); // adresses apprises en marche (sticky)
    this.violations = 0;
    this.errDisabled = false;
  }

  /**
   * Décide pour une trame dont l'adresse source est `mac`.
   * @returns {'allow'|'learn'|'violation'}
   */
  check(mac) {
    const upper = mac.toUpperCase();
    if (this.allowed.has(upper) || this.learned.has(upper)) return 'allow';
    if (this.allowed.size + this.learned.size < this.maximum) {
      this.learned.add(upper);
      return 'learn';
    }
    this.violations += 1;
    if (this.violation === 'shutdown') this.errDisabled = true;
    return 'violation';
  }

  /** Adresses connues (configurées puis apprises). */
  get macs() {
    return [...this.allowed, ...this.learned];
  }
}
