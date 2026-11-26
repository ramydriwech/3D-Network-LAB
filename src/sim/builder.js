// Construction d'une topologie (éditeur, demande du superviseur).
//
// Toutes les fonctions sont PURES : elles reçoivent un brouillon (un scénario au format des
// fichiers scenarios/*.json) et en retournent une copie modifiée, sans toucher à l'original.
// Cela rend l'annulation triviale (on garde les versions précédentes) et tout se teste
// sans navigateur. L'interface (src/ui/editorPanel.js) ne fait qu'appeler ces fonctions puis
// recharger le brouillon dans la simulation.
//
// Erreurs : une opération impossible lève une BuildError dont le message existe en
// français et en anglais (error.text = { fr, en }).

import { intToIp, ipToInt, isIp, networkOf } from './addr.js';
import { DEFAULT_MODEL, MODELS, portNames } from './catalog.js';
import { analyse, applyFix, diagnose, freeAddress, isRouting } from './diagnostic.js';
import { parseEndpoint, validateScenario } from './scenario.js';

/** Protocoles chargés pour un réseau construit à la main : tout ce que l'on peut jouer. */
export const BUILD_PROTOCOLS = Object.freeze(['arp', 'icmp', 'udp', 'tcp', 'dns', 'dhcp', 'http']);
const PREFIX = { host: 'pc', server: 'srv', switch: 'sw', router: 'r', firewall: 'fw' };
const LABEL = { host: 'PC', server: 'SRV', switch: 'SW', router: 'R', firewall: 'FW' };
/** Distance minimale entre deux équipements posés automatiquement. */
const SPACING = 4;

export class BuildError extends Error {
  constructor(fr, en) {
    super(fr);
    this.text = { fr, en };
  }
}

const copy = (draft) => structuredClone(draft);
/** Arrondi au décimètre, sans « -0 » (qui ne survit pas à un aller-retour JSON). */
const round = (value) => Math.round(value * 10) / 10 || 0;
const deviceOf = (draft, id) => {
  const def = draft.devices.find((item) => item.id === id);
  if (!def) throw new BuildError(`Équipement « ${id} » introuvable.`, `Device "${id}" not found.`);
  return def;
};

/** Réseau vide, prêt à être construit. */
export function emptyDraft() {
  return {
    format: 1,
    id: 'mon-reseau',
    title: { fr: 'Mon réseau', en: 'My network' },
    summary: {
      fr: 'Réseau construit dans l\'éditeur. Ajoutez des équipements, reliez-les, configurez-les, puis lancez un échange.',
      en: 'Network built in the editor. Add devices, connect them, configure them, then start an exchange.',
    },
    protocols: [...BUILD_PROTOCOLS],
    devices: [],
    links: [],
    steps: [],
  };
}

/** Brouillon à partir d'un scénario existant (pour le modifier sans l'abîmer). */
export function draftFrom(scenario) {
  const draft = copy(scenario);
  draft.id = draft.id.endsWith('-modifie') ? draft.id : `${draft.id}-modifie`;
  draft.title = { fr: `${scenario.title.fr} (modifié)`, en: `${scenario.title.en} (modified)` };
  draft.protocols = [...new Set([...(draft.protocols || []), ...BUILD_PROTOCOLS])];
  return draft;
}

/** Prochain identifiant libre pour un type : pc1, pc2… */
export function nextId(draft, type) {
  const prefix = PREFIX[type];
  for (let n = 1; ; n++) if (!draft.devices.some((def) => def.id === `${prefix}${n}`)) return `${prefix}${n}`;
}

/** Adresse MAC libre (préfixe 02 : adresse « administrée localement », jamais celle d'une vraie carte). */
export function freeMac(draft, taken = new Set()) {
  const used = new Set([...taken, ...draft.devices.flatMap((def) => (def.interfaces || []).map((iface) => (iface.mac || '').toUpperCase()))]);
  for (let n = 1; n < 0xffffff; n++) {
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((b) => b.toString(16).padStart(2, '0'));
    const mac = `02:00:00:${bytes.join(':')}`.toUpperCase();
    if (!used.has(mac)) return mac;
  }
  throw new BuildError('Plus d\'adresse MAC libre.', 'No free MAC address left.');
}

/** Une place libre près de `near` (ou du centre), en spirale. */
export function freePosition(draft, near = [0, 0, 0]) {
  const busy = (x, z) => draft.devices.some((def) => Math.hypot(def.position[0] - x, def.position[2] - z) < SPACING * 0.9);
  if (!busy(near[0], near[2])) return [round(near[0]), 0, round(near[2])];
  for (let ring = 1; ring < 20; ring++) {
    for (let step = 0; step < ring * 8; step++) {
      const angle = (step / (ring * 8)) * Math.PI * 2;
      const x = round(near[0] + Math.cos(angle) * ring * SPACING);
      const z = round(near[2] + Math.sin(angle) * ring * SPACING);
      if (!busy(x, z)) return [x, 0, z];
    }
  }
  return [near[0] + draft.devices.length * SPACING, 0, near[2]];
}

/** Interfaces d'un nouvel équipement d'après son modèle (sauf switch : ses ports sont libres). */
function interfacesFor(draft, type, modelId) {
  if (type === 'switch') return undefined;
  const names = portNames(MODELS[modelId]);
  const taken = new Set();
  return names.map((name) => {
    const mac = freeMac(draft, taken);
    taken.add(mac);
    return { name, mac };
  });
}

/**
 * Ajoute un équipement. `options` : { model, position, name }.
 * @returns {{ draft, id }}
 */
export function addDevice(draft, type, options = {}) {
  if (!PREFIX[type]) throw new BuildError(`Type d'équipement inconnu : ${type}.`, `Unknown device type: ${type}.`);
  const model = options.model || DEFAULT_MODEL[type];
  if (!MODELS[model] || MODELS[model].type !== type) throw new BuildError(`Le modèle ${model} n'est pas un ${type}.`, `Model ${model} is not a ${type}.`);
  const next = copy(draft);
  const id = nextId(next, type);
  const def = {
    id, type, name: options.name || `${LABEL[type]}${id.slice(PREFIX[type].length)}`,
    model, position: options.position ? [...options.position] : freePosition(next),
  };
  const interfaces = interfacesFor(next, type, model);
  if (interfaces) def.interfaces = interfaces;
  next.devices.push(def);
  return { draft: next, id };
}

/** Retire un équipement, ses câbles et les étapes qui le citent. */
export function removeDevice(draft, id) {
  deviceOf(draft, id);
  const next = copy(draft);
  next.devices = next.devices.filter((def) => def.id !== id);
  next.links = next.links.filter((link) => parseEndpoint(link.a).device !== id && parseEndpoint(link.b).device !== id);
  const mentions = (step) => step.from === id || step.to === id || (step.steps || []).some(mentions);
  next.steps = next.steps.filter((step) => !mentions(step));
  return next;
}

/** Déplace un équipement (coordonnées arrondies au décimètre). */
export function moveDevice(draft, id, position) {
  const next = copy(draft);
  deviceOf(next, id).position = [round(position[0]), 0, round(position[2])];
  return next;
}

/** Ports libres d'un équipement, dans l'ordre du modèle. */
export function freePorts(draft, id) {
  const def = deviceOf(draft, id);
  const used = new Set(draft.links.flatMap((link) => [link.a, link.b]).filter((end) => end.startsWith(id + ':')).map((end) => end.slice(id.length + 1)));
  const names = def.type === 'switch'
    ? portNames(MODELS[def.model] || MODELS[DEFAULT_MODEL.switch])
    : (def.interfaces || []).map((iface) => iface.name);
  return names.filter((name) => !used.has(name));
}

/** Prochain identifiant de câble libre : l1, l2… */
function nextLinkId(draft) {
  for (let n = 1; ; n++) if (!draft.links.some((link) => link.id === `l${n}`)) return `l${n}`;
}

/**
 * Relie deux équipements sur leur premier port libre. `options` : { cable, length, portA, portB }.
 * @returns {{ draft, id }}
 */
export function addLink(draft, aId, bId, options = {}) {
  if (aId === bId) throw new BuildError('Un câble relie deux équipements différents.', 'A cable connects two different devices.');
  const a = deviceOf(draft, aId);
  const b = deviceOf(draft, bId);
  const isHost = (def) => def.type === 'host' || def.type === 'server';
  if (isHost(a) && isHost(b)) {
    throw new BuildError(
      'Deux postes ne se relient pas directement ici : passez par un switch (ou un routeur).',
      'Two computers are not connected directly here: go through a switch (or a router).',
    );
  }
  const portA = options.portA || freePorts(draft, aId)[0];
  const portB = options.portB || freePorts(draft, bId)[0];
  if (!portA) throw new BuildError(`${a.name} n'a plus de port libre.`, `${a.name} has no free port left.`);
  if (!portB) throw new BuildError(`${b.name} n'a plus de port libre.`, `${b.name} has no free port left.`);
  const next = copy(draft);
  const id = nextLinkId(next);
  const link = { id, a: `${aId}:${portA}`, b: `${bId}:${portB}` };
  if (options.cable) link.cable = options.cable;
  if (options.length) link.length = options.length;
  next.links.push(link);
  return { draft: next, id };
}

export function removeLink(draft, id) {
  if (!draft.links.some((link) => link.id === id)) throw new BuildError(`Câble « ${id} » introuvable.`, `Cable "${id}" not found.`);
  const next = copy(draft);
  next.links = next.links.filter((link) => link.id !== id);
  return next;
}

/** Change le câble d'un lien : { cable, length }. */
export function updateLink(draft, id, patch) {
  const next = copy(draft);
  const link = next.links.find((item) => item.id === id);
  if (!link) throw new BuildError(`Câble « ${id} » introuvable.`, `Cable "${id}" not found.`);
  for (const key of ['cable', 'length']) {
    if (patch[key] === null) delete link[key];
    else if (patch[key] !== undefined) link[key] = patch[key];
  }
  return next;
}

/**
 * Modifie un équipement : { name, model, gateway, dns } (null retire le réglage).
 * Changer de modèle garde les câbles ; c'est refusé si un câble est sur un port que le
 * nouveau modèle n'a pas.
 */
export function updateDevice(draft, id, patch) {
  const next = copy(draft);
  const def = deviceOf(next, id);
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new BuildError('Le nom ne peut pas être vide.', 'The name cannot be empty.');
    def.name = name;
  }
  for (const key of ['gateway', 'dns']) {
    if (patch[key] === undefined) continue;
    if (patch[key] === null || patch[key] === '') delete def[key];
    else if (!isIp(patch[key])) throw new BuildError(`« ${patch[key]} » n'est pas une adresse IPv4.`, `"${patch[key]}" is not an IPv4 address.`);
    else def[key] = patch[key];
  }
  if (patch.model !== undefined && patch.model !== def.model) {
    const model = MODELS[patch.model];
    if (!model || model.type !== def.type) throw new BuildError(`Le modèle ${patch.model} ne convient pas.`, `Model ${patch.model} does not fit.`);
    const names = portNames(model);
    const cabled = next.links.flatMap((link) => [link.a, link.b]).filter((end) => end.startsWith(id + ':')).map((end) => end.slice(id.length + 1));
    const missing = cabled.filter((port) => !names.includes(port));
    if (missing.length) {
      throw new BuildError(`Le ${model.name} n'a pas le(s) port(s) ${missing.join(', ')} où des câbles sont branchés.`,
        `The ${model.name} lacks port(s) ${missing.join(', ')} where cables are plugged in.`);
    }
    def.model = patch.model;
    if (def.type !== 'switch') {
      // Les interfaces suivent les ports du modèle ; celles qui restent gardent leur réglage.
      const old = new Map((def.interfaces || []).map((iface) => [iface.name, iface]));
      const taken = new Set();
      def.interfaces = names.map((name) => {
        if (old.has(name)) return old.get(name);
        const mac = freeMac(next, taken);
        taken.add(mac);
        return { name, mac };
      });
    }
  }
  return next;
}

/** Adresse d'une interface ; `ip` null retire l'adresse. */
export function setAddress(draft, id, ifaceName, ip, prefix = 24) {
  const next = copy(draft);
  const def = deviceOf(next, id);
  const iface = (def.interfaces || []).find((item) => item.name === ifaceName);
  if (!iface) throw new BuildError(`${def.name} n'a pas d'interface ${ifaceName}.`, `${def.name} has no ${ifaceName} interface.`);
  if (ip === null || ip === '') {
    delete iface.ip;
    delete iface.prefix;
    return next;
  }
  if (!isIp(ip)) throw new BuildError(`« ${ip} » n'est pas une adresse IPv4.`, `"${ip}" is not an IPv4 address.`);
  const length = Number(prefix);
  if (!Number.isInteger(length) || length < 1 || length > 30) throw new BuildError('Préfixe : entier de 1 à 30.', 'Prefix: integer from 1 to 30.');
  const size = 2 ** (32 - length);
  const offset = ipToInt(ip) % size;
  if (offset === 0 || offset === size - 1) {
    throw new BuildError(`${ip}/${length} est l'adresse du réseau ou de diffusion : choisissez une adresse entre les deux.`,
      `${ip}/${length} is the network or broadcast address: pick an address in between.`);
  }
  iface.ip = ip;
  iface.prefix = length;
  return next;
}

/** Remplace les routes statiques d'un routeur : [{ network, prefix, via }]. */
export function setRoutes(draft, id, routes) {
  const next = copy(draft);
  const def = deviceOf(next, id);
  for (const route of routes) {
    if (!isIp(route.network) || !isIp(route.via) || !Number.isInteger(Number(route.prefix))) {
      throw new BuildError('Route : réseau, préfixe et prochain saut attendus.', 'Route: network, prefix and next hop expected.');
    }
  }
  def.routes = routes.map((route) => ({ network: networkOf(route.network, Number(route.prefix)), prefix: Number(route.prefix), via: route.via }));
  if (!def.routes.length) delete def.routes;
  return next;
}

/** Rôles proposés pour un serveur (ou un PC), avec leur configuration par défaut. */
export const ROLES = Object.freeze(['dhcp', 'dns', 'http', 'tcp']);

/** Active (config) ou retire (null) un service ; `config` absente = réglage par défaut proposé. */
export function setService(draft, id, role, enabled) {
  if (!ROLES.includes(role)) throw new BuildError(`Rôle inconnu : ${role}.`, `Unknown role: ${role}.`);
  const next = copy(draft);
  const def = deviceOf(next, id);
  if (!enabled) {
    if (def.services) delete def.services[role];
    if (def.services && !Object.keys(def.services).length) delete def.services;
    return next;
  }
  const own = (def.interfaces || []).find((iface) => iface.ip);
  if (!own && role !== 'tcp') {
    throw new BuildError(`Donnez d'abord une adresse IP à ${def.name} : ses clients doivent pouvoir le joindre.`,
      `Give ${def.name} an IP address first: its clients must be able to reach it.`);
  }
  def.services = def.services || {};
  if (role === 'tcp') def.services.tcp = { listen: [5000] };
  if (role === 'http') def.services.http = { port: 80, pages: { '/': { title: def.name, body: `<h1>${def.name}</h1><p>Serveur web du réseau.</p>` } } };
  if (role === 'dns') {
    const records = {};
    for (const other of next.devices) {
      const address = (other.interfaces || []).find((iface) => iface.ip);
      if (address && (other.type === 'host' || other.type === 'server')) records[`${other.name.toLowerCase()}.lan`] = address.ip;
    }
    def.services.dns = { records };
  }
  if (role === 'dhcp') {
    const base = ipToInt(networkOf(own.ip, own.prefix));
    const size = 2 ** (32 - own.prefix);
    const start = Math.min(100, Math.max(2, Math.floor(size / 2)));
    const end = Math.min(start + 20, size - 2);
    const view = analyse(next);
    const domain = view.domainOf(def.id, own.name);
    const router = view.addressed.find((entry) => isRouting(entry.def) && entry.domain === domain);
    def.services.dhcp = { start: intToIp(base + start), end: intToIp(base + end), prefix: own.prefix, lease: 3600 };
    if (router) def.services.dhcp.gateway = router.iface.ip;
    const dns = next.devices.find((other) => other.services && other.services.dns);
    if (dns) def.services.dhcp.dns = dns.interfaces.find((iface) => iface.ip).ip;
  }
  return next;
}

/** Adresse proposée pour une interface : libre dans le réseau de ses voisins, sinon nouveau réseau. */
export function suggestAddress(draft, id, ifaceName) {
  const def = deviceOf(draft, id);
  const view = analyse(draft);
  const domain = view.domainOf(id, ifaceName);
  const neighbour = view.addressed.find((entry) => entry.domain === domain && !(entry.def.id === id && entry.iface.name === ifaceName));
  if (neighbour) {
    const prefix = neighbour.iface.prefix;
    if (isRouting(def)) {
      // Un routeur prend de préférence la première adresse du réseau (.1), habitude courante.
      const first = intToIp(ipToInt(networkOf(neighbour.iface.ip, prefix)) + 1);
      if (!view.addressed.some((entry) => entry.iface.ip === first)) return { ip: first, prefix };
    }
    const ip = freeAddress(draft, neighbour.iface.ip, prefix);
    return ip ? { ip, prefix } : null;
  }
  const network = freeNetwork(draft);
  return { ip: intToIp(ipToInt(network) + (isRouting(def) ? 1 : 10)), prefix: 24 };
}

/** Premier réseau 192.168.N.0/24 que personne n'utilise. */
export function freeNetwork(draft, taken = new Set()) {
  const used = new Set([...taken]);
  for (const def of draft.devices) for (const iface of def.interfaces || []) if (iface.ip) used.add(networkOf(iface.ip, 24));
  for (let n = 1; n < 255; n++) if (!used.has(`192.168.${n}.0`)) return `192.168.${n}.0`;
  throw new BuildError('Plus de réseau libre.', 'No free network left.');
}

/** Passerelle proposée : l'adresse d'un routeur dans le même réseau. */
export function suggestGateway(draft, id) {
  const view = analyse(draft);
  const mine = view.addressed.find((entry) => entry.def.id === id);
  if (!mine) return null;
  const router = view.addressed.find((entry) => isRouting(entry.def) && entry.domain === mine.domain && entry.network === mine.network);
  return router ? router.iface.ip : null;
}

/**
 * Adressage automatique de tout ce qui est relié et n'a pas encore d'adresse :
 *   1. un réseau par domaine de diffusion (192.168.N.0/24 ; 10.0.N.0/30 entre deux routeurs) ;
 *   2. .1, .2… pour les routeurs, .10, .11… pour les postes et serveurs ;
 *   3. passerelle de chaque poste = son routeur ;
 *   4. routes statiques ajoutées tant que le diagnostic en trouve une qui manque.
 * Ce qui est déjà configuré n'est pas modifié.
 * @returns {{ draft, changes: number }}
 */
export function autoAddress(draft) {
  let next = copy(draft);
  let changes = 0;
  const view = analyse(next);
  const domains = new Map(); // domaine -> [{ def, iface }]
  for (const def of next.devices) {
    if (def.type === 'switch') continue;
    for (const iface of def.interfaces || []) {
      const cabled = next.links.some((link) => link.a === `${def.id}:${iface.name}` || link.b === `${def.id}:${iface.name}`);
      if (!cabled) continue;
      const domain = view.domainOf(def.id, iface.name);
      if (!domains.has(domain)) domains.set(domain, []);
      domains.get(domain).push({ def, iface });
    }
  }
  const takenNets = new Set();
  let transit = -4; // réseaux de transit 10.0.0.0/30, 10.0.0.4/30…
  for (const members of domains.values()) {
    const existing = members.find((m) => m.iface.ip);
    let base;
    let prefix;
    if (existing) {
      prefix = existing.iface.prefix;
      base = ipToInt(networkOf(existing.iface.ip, prefix));
    } else if (members.every((m) => isRouting(m.def)) && members.length === 2) {
      do { transit += 4; } while (next.devices.some((def) => (def.interfaces || []).some((iface) => iface.ip && networkOf(iface.ip, 30) === intToIp(ipToInt('10.0.0.0') + transit))));
      base = ipToInt('10.0.0.0') + transit;
      prefix = 30;
    } else {
      const network = freeNetwork(next, takenNets);
      takenNets.add(network);
      base = ipToInt(network);
      prefix = 24;
    }
    const size = 2 ** (32 - prefix);
    const used = new Set(next.devices.flatMap((def) => (def.interfaces || []).map((iface) => iface.ip)).filter(Boolean));
    const take = (from) => {
      for (let offset = from; offset < size - 1; offset++) {
        const ip = intToIp(base + offset);
        if (!used.has(ip)) { used.add(ip); return ip; }
      }
      return null;
    };
    const ordered = [...members].sort((x, y) => (isRouting(x.def) ? 0 : 1) - (isRouting(y.def) ? 0 : 1));
    for (const member of ordered) {
      if (member.iface.ip) continue;
      const ip = take(isRouting(member.def) ? 1 : (prefix >= 30 ? 1 : 10));
      if (!ip) continue;
      member.iface.ip = ip;
      member.iface.prefix = prefix;
      changes += 1;
    }
  }
  // Passerelles
  for (const def of next.devices) {
    if ((def.type !== 'host' && def.type !== 'server') || def.gateway) continue;
    const gateway = suggestGateway(next, def.id);
    if (gateway) { def.gateway = gateway; changes += 1; }
  }
  // Routes : on applique les corrections « route manquante » du diagnostic.
  for (let round = 0; round < 50; round++) {
    const missing = diagnose(next).findings.find((item) => item.fix && item.fix.op === 'addRoute');
    if (!missing) break;
    next = applyFix(next, missing.fix);
    changes += 1;
  }
  return { draft: next, changes };
}

/** Ajoute une étape (échange à jouer) : { action, from, to, … }. */
export function addStep(draft, step) {
  const next = copy(draft);
  next.steps.push(step);
  return next;
}

/** Texte JSON du brouillon, prêt à télécharger. */
export function exportJson(draft) {
  return JSON.stringify(draft, null, 2) + '\n';
}

/** Lit un fichier JSON importé ; lève une BuildError claire s'il n'est pas valide. */
export function importJson(textValue) {
  let scenario;
  try {
    scenario = JSON.parse(textValue);
  } catch (error) {
    throw new BuildError(`Ce fichier n'est pas du JSON valide (${error.message}).`, `This file is not valid JSON (${error.message}).`);
  }
  const { ok, errors } = validateScenario(scenario);
  if (!ok) throw new BuildError(`Scénario invalide :\n- ${errors.join('\n- ')}`, `Invalid scenario:\n- ${errors.join('\n- ')}`);
  return scenario;
}

/** Historique pour annuler / rétablir (on garde des versions complètes : elles sont petites). */
export class History {
  constructor(initial, limit = 60) {
    this.past = [];
    this.future = [];
    this.present = initial;
    this.limit = limit;
  }

  push(next) {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    return next;
  }

  undo() {
    if (!this.past.length) return null;
    this.future.push(this.present);
    this.present = this.past.pop();
    return this.present;
  }

  redo() {
    if (!this.future.length) return null;
    this.past.push(this.present);
    this.present = this.future.pop();
    return this.present;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
