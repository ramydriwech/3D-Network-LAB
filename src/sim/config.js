// Configuration d'un équipement (laboratoire de Steve, S7).
//
// Ce que les commandes de console changent dans un équipement : interfaces, VLAN, sécurité
// des ports, listes d'accès, NAT, zones du pare-feu. Comme builder.js, chaque fonction
// reçoit un scénario et en retourne une COPIE modifiée ; une erreur lève une BuildError
// (message en français et en anglais). La console (cli.js) ne fait que traduire le texte
// tapé en appels à ces fonctions, ce qui permet d'avoir deux styles de commandes (IOS et
// VRP) pour une seule logique.

import { intToIp, ipToInt, isIp, isMac, networkOf } from './addr.js';
import { BuildError } from './builder.js';
import { checkRule } from './security.js';

const copy = (scenario) => structuredClone(scenario);

function deviceOf(scenario, id) {
  const def = scenario.devices.find((item) => item.id === id);
  if (!def) throw new BuildError(`Équipement « ${id} » introuvable.`, `Device "${id}" not found.`);
  return def;
}

/** Masque (255.255.255.0) ou longueur (24, /24) → longueur de préfixe. */
export function prefixOf(text) {
  const value = String(text).replace(/^\//, '');
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (n >= 0 && n <= 32) return n;
    return null;
  }
  if (!isIp(value)) return null;
  const bits = ipToInt(value).toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}

/** Longueur → masque : 24 → 255.255.255.0. */
export function maskOf(prefix) {
  return intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
}

/** Masque générique (wildcard) → longueur : 0.0.0.255 → 24. */
export function wildcardPrefix(text) {
  if (!isIp(text)) return null;
  const inverted = intToIp((~ipToInt(text)) >>> 0);
  return prefixOf(inverted);
}

/** Interface d'un équipement (créée si c'est un port de switch, qui n'existe que par ses câbles). */
function ifaceOf(def, name, { create = false } = {}) {
  if (def.type === 'switch') {
    def.ports = def.ports || {};
    if (!def.ports[name]) def.ports[name] = {};
    return def.ports[name];
  }
  let iface = (def.interfaces || []).find((item) => item.name === name);
  if (!iface && create && name.includes('.')) {
    const parent = name.split('.')[0];
    if (!(def.interfaces || []).some((item) => item.name === parent)) {
      throw new BuildError(`${def.name} n'a pas d'interface ${parent}.`, `${def.name} has no ${parent} interface.`);
    }
    iface = { name };
    def.interfaces.push(iface);
    def.interfaces.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  if (!iface) throw new BuildError(`${def.name} n'a pas d'interface ${name}.`, `${def.name} has no ${name} interface.`);
  return iface;
}

/** Applique `change(def)` à l'équipement `id` d'une copie du scénario. */
export function editDevice(scenario, id, change) {
  const next = copy(scenario);
  change(deviceOf(next, id), next);
  return next;
}

/** Applique `change(iface, def)` à une interface (ou à un port de switch). */
export function editInterface(scenario, id, name, change, options) {
  return editDevice(scenario, id, (def) => change(ifaceOf(def, name, options), def));
}

export function setHostname(scenario, id, name) {
  if (!/^[A-Za-z0-9][\w-]{0,30}$/.test(name)) {
    throw new BuildError('Nom : lettres, chiffres, - et _ (31 caractères au plus).', 'Name: letters, digits, - and _ (31 characters at most).');
  }
  return editDevice(scenario, id, (def) => { def.name = name; });
}

export function setShutdown(scenario, id, name, down) {
  return editInterface(scenario, id, name, (iface) => {
    if (down) iface.shutdown = true;
    else delete iface.shutdown;
  });
}

export function setDescription(scenario, id, name, text) {
  return editInterface(scenario, id, name, (iface) => {
    if (text) iface.description = text;
    else delete iface.description;
  });
}

/** Sous-interface 802.1Q : « encapsulation dot1Q 10 » / « dot1q termination vid 10 ». */
export function setSubinterfaceVlan(scenario, id, name, vlan) {
  if (!name.includes('.')) throw new BuildError('Seule une sous-interface (ex. g0/0.10) porte un VLAN.', 'Only a sub-interface (e.g. g0/0.10) carries a VLAN.');
  if (!(Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094)) throw new BuildError('VLAN : 1 à 4094.', 'VLAN: 1 to 4094.');
  return editInterface(scenario, id, name, (iface) => { iface.vlan = vlan; }, { create: true });
}

/** Crée une sous-interface vide (quand on y entre pour la première fois). */
export function ensureSubinterface(scenario, id, name) {
  const def = deviceOf(scenario, id);
  if ((def.interfaces || []).some((item) => item.name === name)) return scenario;
  return editInterface(scenario, id, name, () => {}, { create: true });
}

export function removeSubinterface(scenario, id, name) {
  return editDevice(scenario, id, (def) => {
    def.interfaces = (def.interfaces || []).filter((item) => item.name !== name);
  });
}

// ------------------------------------------------------------------------- switch

function vlanNumber(text) {
  const n = Number(text);
  if (!(Number.isInteger(n) && n >= 1 && n <= 4094)) throw new BuildError(`VLAN « ${text} » : numéro de 1 à 4094.`, `VLAN "${text}": number from 1 to 4094.`);
  return n;
}

/** « 10,20,30-32 » → [10, 20, 30, 31, 32]. */
export function vlanList(text) {
  const list = [];
  for (const part of String(text).split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) for (let v = vlanNumber(range[1]); v <= vlanNumber(range[2]); v++) list.push(v);
    else list.push(vlanNumber(part));
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

function requireSwitch(def) {
  if (def.type !== 'switch') throw new BuildError(`${def.name} n'est pas un switch.`, `${def.name} is not a switch.`);
}

export function addVlan(scenario, id, vlan, name) {
  const number = vlanNumber(vlan);
  return editDevice(scenario, id, (def) => {
    requireSwitch(def);
    def.vlans = def.vlans || {};
    def.vlans[number] = name || def.vlans[number] || `VLAN${String(number).padStart(4, '0')}`;
  });
}

export function removeVlan(scenario, id, vlan) {
  const number = vlanNumber(vlan);
  if (number === 1) throw new BuildError('Le VLAN 1 ne peut pas être supprimé.', 'VLAN 1 cannot be deleted.');
  return editDevice(scenario, id, (def) => {
    if (def.vlans) delete def.vlans[number];
  });
}

export function setSwitchportMode(scenario, id, port, mode) {
  return editDevice(scenario, id, (def) => {
    requireSwitch(def);
    const config = ifaceOf(def, port);
    if (mode === 'trunk') {
      config.mode = 'trunk';
      delete config.vlan;
    } else {
      delete config.mode;
      delete config.allowed;
      delete config.native;
    }
  });
}

export function setAccessVlan(scenario, id, port, vlan) {
  const number = vlanNumber(vlan);
  return editDevice(scenario, id, (def) => {
    requireSwitch(def);
    const config = ifaceOf(def, port);
    if (number === 1) delete config.vlan;
    else config.vlan = number;
    def.vlans = def.vlans || {};
    if (number !== 1 && !def.vlans[number]) def.vlans[number] = `VLAN${String(number).padStart(4, '0')}`; // comme un vrai switch, le VLAN est créé
  });
}

export function setTrunkAllowed(scenario, id, port, list) {
  return editDevice(scenario, id, (def) => {
    requireSwitch(def);
    const config = ifaceOf(def, port);
    if (list === null) delete config.allowed;
    else config.allowed = list;
  });
}

export function setNativeVlan(scenario, id, port, vlan) {
  const number = vlanNumber(vlan);
  return editDevice(scenario, id, (def) => {
    const config = ifaceOf(def, port);
    if (number === 1) delete config.native;
    else config.native = number;
  });
}

/** Sécurité d'un port : patch { enabled, maximum, sticky, mac, violation }. */
export function setPortSecurity(scenario, id, port, patch) {
  return editDevice(scenario, id, (def) => {
    requireSwitch(def);
    const config = ifaceOf(def, port);
    if (patch.enabled === false) {
      delete config.security;
      return;
    }
    const security = config.security || { maximum: 1, violation: 'shutdown' };
    if (patch.maximum != null) {
      if (!(Number.isInteger(patch.maximum) && patch.maximum >= 1 && patch.maximum <= 132)) throw new BuildError('Maximum : 1 à 132 adresses.', 'Maximum: 1 to 132 addresses.');
      security.maximum = patch.maximum;
    }
    if (patch.sticky != null) security.sticky = patch.sticky;
    if (patch.violation != null) {
      if (!['shutdown', 'restrict', 'protect'].includes(patch.violation)) throw new BuildError('Violation : shutdown, restrict ou protect.', 'Violation: shutdown, restrict or protect.');
      security.violation = patch.violation;
    }
    if (patch.mac != null) {
      const mac = normalizeMac(patch.mac);
      if (!mac) throw new BuildError(`« ${patch.mac} » n'est pas une adresse MAC.`, `"${patch.mac}" is not a MAC address.`);
      security.macs = [...new Set([...(security.macs || []), mac])];
    }
    config.security = security;
  });
}

/** Accepte 02:00:00:00:5E:12, 02-00-…, ou 0200.0000.5e12 (style IOS). */
export function normalizeMac(text) {
  const hex = String(text).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) return null;
  const mac = hex.match(/../g).join(':').toUpperCase();
  return isMac(mac) ? mac : null;
}

// ------------------------------------------------------------- routeur et pare-feu

function requireRouting(def) {
  if (def.type !== 'router' && def.type !== 'firewall') {
    throw new BuildError(`${def.name} n'est ni un routeur ni un pare-feu.`, `${def.name} is neither a router nor a firewall.`);
  }
}

export function addRoute(scenario, id, network, prefix, via) {
  if (!isIp(network) || !isIp(via) || prefix == null) throw new BuildError('Route : réseau, masque et prochain saut attendus.', 'Route: network, mask and next hop expected.');
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    const route = { network: networkOf(network, prefix), prefix, via };
    def.routes = [...(def.routes || []).filter((r) => !(r.network === route.network && r.prefix === prefix && r.via === via)), route];
  });
}

export function removeRoute(scenario, id, network, prefix, via) {
  return editDevice(scenario, id, (def) => {
    const target = networkOf(network, prefix);
    def.routes = (def.routes || []).filter((r) => !(r.network === target && r.prefix === prefix && (!via || r.via === via)));
    if (!def.routes.length) delete def.routes;
  });
}

/** Ajoute une règle à la liste `name` (créée au besoin), à la position `seq` (numéro × 10). */
export function addAclRule(scenario, id, name, rule, seq = null) {
  const problem = checkRule(rule);
  if (problem) throw new BuildError(`Règle refusée : ${problem}.`, `Rule refused: ${problem}.`);
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    def.acls = def.acls || {};
    const rules = def.acls[name] || [];
    const clean = { action: rule.action, proto: rule.proto || 'ip', src: rule.src, dst: rule.dst };
    if (rule.port != null) clean.port = rule.port;
    // Les règles sont numérotées 10, 20, 30… : « 15 permit … » s'insère entre 10 et 20.
    const index = seq != null ? Math.max(0, Math.min(rules.length, Math.ceil(seq / 10) - 1)) : rules.length;
    rules.splice(index, 0, clean);
    def.acls[name] = rules;
  });
}

export function ensureAcl(scenario, id, name) {
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    def.acls = def.acls || {};
    def.acls[name] = def.acls[name] || [];
  });
}

export function removeAclRule(scenario, id, name, seq) {
  return editDevice(scenario, id, (def) => {
    const rules = (def.acls || {})[name];
    if (!rules) throw new BuildError(`Liste « ${name} » inconnue.`, `List "${name}" unknown.`);
    const index = Math.floor(seq / 10) - 1;
    if (!rules[index]) throw new BuildError(`La liste ${name} n'a pas de règle ${seq}.`, `List ${name} has no rule ${seq}.`);
    rules.splice(index, 1);
  });
}

export function removeAcl(scenario, id, name) {
  return editDevice(scenario, id, (def) => {
    if (def.acls) delete def.acls[name];
    for (const iface of def.interfaces || []) {
      if (!iface.acl) continue;
      for (const dir of ['in', 'out']) if (iface.acl[dir] === name) delete iface.acl[dir];
      if (!Object.keys(iface.acl).length) delete iface.acl;
    }
    for (const rule of def.nat || []) if (rule.acl === name) delete rule.acl;
  });
}

/** Applique (ou retire, name = null) une liste d'accès sur une interface, dans un sens. */
export function bindAcl(scenario, id, iface, dir, name) {
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    const target = ifaceOf(def, iface);
    if (name) {
      def.acls = def.acls || {};
      def.acls[name] = def.acls[name] || []; // comme sur un vrai routeur, la liste peut être remplie après
      target.acl = { ...(target.acl || {}), [dir]: name };
    } else if (target.acl) {
      delete target.acl[dir];
      if (!Object.keys(target.acl).length) delete target.acl;
    }
  });
}

export function setNatRole(scenario, id, iface, role) {
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    const target = ifaceOf(def, iface);
    if (role) target.nat = role;
    else delete target.nat;
  });
}

/** NAT : { type: 'overload', acl? } ou { type: 'static', inside, outside }. */
export function addNatRule(scenario, id, rule) {
  return editDevice(scenario, id, (def) => {
    requireRouting(def);
    if (rule.type === 'static' && (!isIp(rule.inside) || !isIp(rule.outside))) throw new BuildError('NAT statique : deux adresses attendues.', 'Static NAT: two addresses expected.');
    def.nat = (def.nat || []).filter((r) => !(r.type === rule.type && (rule.type === 'overload' || r.inside === rule.inside)));
    // Les traductions statiques passent avant le NAT overload.
    if (rule.type === 'static') def.nat.unshift(rule);
    else def.nat.push(rule);
  });
}

export function removeNatRule(scenario, id, rule) {
  return editDevice(scenario, id, (def) => {
    def.nat = (def.nat || []).filter((r) => !(r.type === rule.type && (rule.type === 'overload' || r.inside === rule.inside)));
    if (!def.nat.length) delete def.nat;
  });
}

/** Zone et niveau de sécurité d'une interface de pare-feu (« nameif » / « security-level »). */
export function setZone(scenario, id, iface, zone, level) {
  return editDevice(scenario, id, (def) => {
    if (def.type !== 'firewall') throw new BuildError(`${def.name} n'est pas un pare-feu.`, `${def.name} is not a firewall.`);
    const target = ifaceOf(def, iface);
    if (zone !== undefined) {
      if (zone) target.zone = zone;
      else delete target.zone;
    }
    if (level !== undefined) {
      if (level === null) delete target.level;
      else if (!(Number.isInteger(level) && level >= 0 && level <= 100)) throw new BuildError('Niveau de sécurité : 0 à 100.', 'Security level: 0 to 100.');
      else target.level = level;
    }
  });
}
