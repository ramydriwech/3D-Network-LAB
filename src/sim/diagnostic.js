// Diagnostic du réseau et recommandations (demande du superviseur).
//
// diagnose(scenario, { traffic }) examine une topologie et retourne une liste de constats.
// Chaque constat dit QUOI (titre), POURQUOI c'est un problème (cause), COMMENT le corriger
// (conseil), et indique les équipements et câbles concernés pour les surligner dans la scène.
// Quand la correction est sûre, le constat porte aussi une correction automatique (`fix`)
// qu'applyFix() applique à une COPIE du scénario : l'interface la propose en un clic.
//
// Les règles sont de simples fonctions, regroupées par thème (adressage, passerelle,
// routage, câblage, performances). Elles ne lisent que le scénario (et, si on le fournit,
// l'état du trafic) : tout se teste sans navigateur.
//
// Gravité : 'error' (la communication échoue), 'warning' (fonctionne mal ou de façon
// fragile), 'info' (à savoir, ou à améliorer).

import { inNetwork, intToIp, ipToInt, isIp, networkOf } from './addr.js';
import { CABLES, DEFAULT_CABLE, DEFAULT_LENGTH, MODELS, formatSpeed, linkSpeed, modelOf, portNames } from './catalog.js';
import { parseEndpoint } from './scenario.js';
import { LOAD_LEVELS } from './traffic.js';

export const SEVERITIES = Object.freeze(['error', 'warning', 'info']);

const T = {
  dupIp: {
    title: { fr: 'Adresse IP en double : {ip}', en: 'Duplicate IP address: {ip}' },
    cause: { fr: '{names} utilisent la même adresse. Les réponses ARP se contredisent : les paquets arrivent tantôt chez l\'un, tantôt chez l\'autre.', en: '{names} use the same address. ARP replies contradict each other: packets reach one or the other at random.' },
    fix: { fr: 'Donner à {name} une adresse libre du même réseau, par exemple {free}.', en: 'Give {name} a free address on the same network, for example {free}.' },
  },
  dupMac: {
    title: { fr: 'Adresse MAC en double : {mac}', en: 'Duplicate MAC address: {mac}' },
    cause: { fr: '{names} ont la même adresse MAC. Le switch ne sait plus sur quel port envoyer les trames.', en: '{names} have the same MAC address. The switch no longer knows which port to send frames to.' },
    fix: { fr: 'Changer l\'adresse MAC de {name} (chaque carte réseau a une MAC unique).', en: 'Change {name}\'s MAC address (every network card has a unique MAC).' },
  },
  noIp: {
    title: { fr: '{name} n\'a pas d\'adresse IP', en: '{name} has no IP address' },
    cause: { fr: 'Sans adresse IP et sans serveur DHCP sur son réseau, {name} ne peut parler à personne au niveau IP.', en: 'Without an IP address and no DHCP server on its network, {name} cannot talk to anyone at the IP level.' },
    fix: { fr: 'Lui donner l\'adresse {free}/{prefix}, libre dans le réseau de ses voisins.', en: 'Give it the address {free}/{prefix}, free on its neighbours\' network.' },
  },
  dhcpWait: {
    title: { fr: '{name} attend une adresse du DHCP', en: '{name} waits for an address from DHCP' },
    cause: { fr: '{name} n\'a pas encore d\'adresse IP : il devra d\'abord la demander au serveur DHCP {server}.', en: '{name} has no IP address yet: it must first ask the DHCP server {server} for one.' },
    fix: { fr: 'Rien à faire : lancez l\'étape DHCP avant les autres échanges.', en: 'Nothing to do: run the DHCP step before the other exchanges.' },
  },
  gwOutside: {
    title: { fr: 'Passerelle de {name} hors de son réseau', en: '{name}\'s gateway is outside its network' },
    cause: { fr: 'La passerelle {gateway} n\'est pas dans le réseau {network}/{prefix} de {name} : il ne peut pas la joindre directement, donc rien ne sort du réseau.', en: 'Gateway {gateway} is not in {name}\'s network {network}/{prefix}: it cannot reach it directly, so nothing leaves the network.' },
    fix: { fr: 'Utiliser {suggest}, l\'adresse du routeur {router} sur ce réseau.', en: 'Use {suggest}, the address of router {router} on this network.' },
  },
  gwNotRouter: {
    title: { fr: 'La passerelle de {name} n\'est pas un routeur', en: '{name}\'s gateway is not a router' },
    cause: { fr: '{gateway} {owner}. Les paquets vers les autres réseaux y seront envoyés, mais personne ne les fera suivre.', en: '{gateway} {owner}. Packets to other networks will be sent there, but nobody will forward them.' },
    fix: { fr: 'Utiliser {suggest}, l\'adresse du routeur {router} sur ce réseau.', en: 'Use {suggest}, the address of router {router} on this network.' },
  },
  gwMissing: {
    title: { fr: '{name} n\'a pas de passerelle', en: '{name} has no gateway' },
    cause: { fr: 'Le réseau compte d\'autres sous-réseaux ({others}). Sans passerelle, {name} ne peut joindre que les machines de son propre réseau.', en: 'The network has other subnets ({others}). Without a gateway, {name} can only reach machines on its own network.' },
    fix: { fr: 'Prendre comme passerelle {suggest} (routeur {router}).', en: 'Use {suggest} (router {router}) as the gateway.' },
  },
  mixedSubnets: {
    title: { fr: 'Deux réseaux IP sur le même switch', en: 'Two IP networks on the same switch' },
    cause: { fr: '{a} et {b} sont reliés sans routeur entre eux, mais sont dans des réseaux différents ({na} et {nb}). Ils ne se parleront pas directement : chacun croira devoir passer par une passerelle.', en: '{a} and {b} are connected without a router between them, but are on different networks ({na} and {nb}). They will not talk directly: each will think it must go through a gateway.' },
    fix: { fr: 'Mettre {b} dans le réseau {na}, par exemple {free}, ou séparer les deux réseaux par un routeur.', en: 'Put {b} on network {na}, for example {free}, or separate the two networks with a router.' },
  },
  noRoute: {
    title: { fr: '{router} ne sait pas joindre {network}/{prefix}', en: '{router} does not know how to reach {network}/{prefix}' },
    cause: { fr: 'Ce réseau existe (il contient {hosts}) mais {router} n\'y est pas branché et n\'a ni route vers lui ni route par défaut : il détruira ces paquets (« réseau inaccessible »).', en: 'This network exists (it holds {hosts}) but {router} is not connected to it and has neither a route to it nor a default route: it will destroy those packets ("network unreachable").' },
    fix: { fr: 'Ajouter sur {router} la route {network}/{prefix} via {via} ({next}).', en: 'Add on {router} the route {network}/{prefix} via {via} ({next}).' },
    fixManual: { fr: 'Ajouter sur {router} une route vers {network}/{prefix} par le routeur voisin qui mène à ce réseau.', en: 'Add on {router} a route to {network}/{prefix} through the neighbouring router that leads to that network.' },
  },
  badVia: {
    title: { fr: 'Route de {router} vers un voisin injoignable', en: '{router}\'s route points to an unreachable neighbour' },
    cause: { fr: 'La route {network}/{prefix} passe par {via}, qui n\'est dans aucun réseau directement branché sur {router}.', en: 'Route {network}/{prefix} goes through {via}, which is in none of the networks directly connected to {router}.' },
    fix: { fr: 'Le prochain saut doit être l\'adresse d\'un routeur voisin, sur un réseau commun.', en: 'The next hop must be the address of a neighbouring router, on a shared network.' },
  },
  isolated: {
    title: { fr: '{name} n\'est relié à rien', en: '{name} is not connected to anything' },
    cause: { fr: 'Aucun câble n\'arrive sur {name} : il ne peut ni envoyer ni recevoir.', en: 'No cable reaches {name}: it can neither send nor receive.' },
    fix: { fr: 'Le brancher sur un switch ou un routeur.', en: 'Plug it into a switch or a router.' },
  },
  loop: {
    title: { fr: 'Boucle entre switchs', en: 'Loop between switches' },
    cause: { fr: 'Les switchs {names} forment une boucle. Sans protocole Spanning Tree, une diffusion (ARP, DHCP…) y tournerait sans fin : c\'est une « tempête de diffusion » qui sature tout le réseau.', en: 'Switches {names} form a loop. Without the Spanning Tree protocol, a broadcast (ARP, DHCP…) would circle forever: a "broadcast storm" that saturates the whole network.' },
    fix: { fr: 'Retirer le câble {link} (ou activer le Spanning Tree sur un vrai réseau).', en: 'Remove cable {link} (or enable Spanning Tree on a real network).' },
  },
  cableReach: {
    title: { fr: 'Câble {link} trop long', en: 'Cable {link} is too long' },
    cause: { fr: '{length} m de {cable} : au-delà de {reach} m, le signal s\'affaiblit et les trames arrivent abîmées.', en: '{length} m of {cable}: beyond {reach} m, the signal weakens and frames arrive damaged.' },
    fix: { fr: 'Utiliser de la fibre (jusqu\'à 300 m) ou ajouter un switch à mi-chemin.', en: 'Use fibre (up to 300 m) or add a switch halfway.' },
  },
  cableLimit: {
    title: { fr: 'Le câble bride le lien {link}', en: 'The cable limits link {link}' },
    cause: { fr: 'Les deux cartes savent aller à {cards}, mais le câble {cable} plafonne à {speed}.', en: 'Both cards can run at {cards}, but the {cable} cable caps it at {speed}.' },
    fix: { fr: 'Remplacer le câble par du {better}.', en: 'Replace the cable with {better}.' },
  },
  cardLimit: {
    title: { fr: '{name} ralentit le lien {link}', en: '{name} slows down link {link}' },
    cause: { fr: 'La carte de {name} ne dépasse pas {slow} alors que {other} irait à {fast} : le lien négocie la plus petite vitesse.', en: '{name}\'s card does not exceed {slow} while {other} could do {fast}: the link negotiates the lowest speed.' },
    fix: { fr: 'Remplacer {name} par un modèle plus rapide ({model}).', en: 'Replace {name} with a faster model ({model}).' },
  },
  serverBottleneck: {
    title: { fr: 'Le lien du serveur {name} est un goulot', en: 'Server {name}\'s link is a bottleneck' },
    cause: { fr: '{name} est relié à {speed} alors que {clients} postes peuvent lui envoyer chacun jusqu\'à {client} : ensemble, ils dépassent ce lien et font la queue sur le port du switch.', en: '{name} is connected at {speed} while {clients} computers can each send it up to {client}: together they exceed that link and queue up on the switch port.' },
    fix: { fr: 'Brancher le serveur sur un port plus rapide (10 Gb/s), ou répartir le service sur plusieurs serveurs.', en: 'Connect the server to a faster port (10 Gb/s), or spread the service over several servers.' },
  },
  unknownPort: {
    title: { fr: 'Port {port} absent du {model}', en: 'Port {port} does not exist on the {model}' },
    cause: { fr: '{name} est un {model} dont les ports sont {ports}. Le câble {link} est branché sur un port qui n\'existe pas sur ce modèle.', en: '{name} is a {model} whose ports are {ports}. Cable {link} is plugged into a port that does not exist on this model.' },
    fix: { fr: 'Brancher le câble sur un port libre, par exemple {free}.', en: 'Plug the cable into a free port, for example {free}.' },
  },
  dnsMissing: {
    title: { fr: 'Serveur DNS de {name} introuvable', en: '{name}\'s DNS server cannot be found' },
    cause: { fr: '{name} demandera les noms à {dns}, mais aucun équipement n\'a cette adresse : ses requêtes DNS resteront sans réponse.', en: '{name} will ask {dns} for names, but no device has that address: its DNS queries will go unanswered.' },
    fix: { fr: 'Utiliser {suggest}, l\'adresse du serveur DNS {server}.', en: 'Use {suggest}, the address of DNS server {server}.' },
    fixManual: { fr: 'Le réseau n\'a aucun serveur DNS : retirer ce réglage, ou ajouter un serveur DNS à cette adresse.', en: 'The network has no DNS server: remove this setting, or add a DNS server at that address.' },
  },
  saturated: {
    title: { fr: 'Lien {link} saturé', en: 'Link {link} is saturated' },
    cause: { fr: 'Le lien est occupé à {load} % sur les dernières secondes : les trames attendent leur tour dans la file du port ({queue} au plus).', en: 'The link is {load}% busy over the last seconds: frames wait their turn in the port queue (up to {queue}).' },
    fix: { fr: 'Augmenter la vitesse de ce lien ou répartir le trafic sur d\'autres liens.', en: 'Increase this link\'s speed or spread the traffic over other links.' },
  },
  losses: {
    title: { fr: 'Trames perdues sur {link}', en: 'Frames lost on {link}' },
    cause: { fr: '{lost} trame(s) se sont perdues sur ce câble. TCP les a retransmises, mais chaque perte coûte du temps.', en: '{lost} frame(s) were lost on this cable. TCP resent them, but every loss costs time.' },
    fix: { fr: 'Sur un vrai réseau : vérifier le câble et les connecteurs, ou le remplacer.', en: 'On a real network: check the cable and connectors, or replace it.' },
  },
  healthy: {
    title: { fr: 'Aucun problème détecté', en: 'No problem detected' },
    cause: { fr: 'Adressage, passerelles, routes et câblage sont cohérents.', en: 'Addressing, gateways, routes and cabling are consistent.' },
    fix: { fr: 'Lancez la lecture pour vérifier les performances : le diagnostic surveille aussi la charge des liens.', en: 'Start playback to check performance: the diagnostic also watches link load.' },
  },
};

/** Texte { fr, en } d'un modèle de message, avec ses paramètres remplacés. */
// Un paramètre peut lui-même être un texte { fr, en }.
function text(template, params) {
  const fill = (value, lang) => value.replace(/\{(\w+)\}/g, (match, key) => {
    const param = params[key];
    if (param == null) return match;
    return typeof param === 'object' ? String(param[lang]) : String(param);
  });
  return { fr: fill(template.fr, 'fr'), en: fill(template.en, 'en') };
}

function finding(rule, severity, key, params, extra = {}) {
  const t = T[key];
  return {
    id: `${key}:${extra.subject || ''}`,
    rule, severity,
    title: text(t.title, params),
    cause: text(t.cause, params),
    advice: text(extra.manual ? t.fixManual : t.fix, params),
    devices: extra.devices || [],
    links: extra.links || [],
    fix: extra.fix || null,
  };
}

const listNames = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} & ${items.at(-1)}`);

/** Vue pratique de la topologie : équipements, interfaces adressées, voisins, domaines. */
/** Équipements qui routent (et donc séparent les domaines de diffusion). */
export const ROUTING = new Set(['router', 'firewall']);
export const isRouting = (def) => !!def && ROUTING.has(def.type);

export function analyse(scenario) {
  const devices = new Map(scenario.devices.map((def) => [def.id, def]));
  const links = scenario.links || [];
  const nameOf = (id) => (devices.get(id) ? devices.get(id).name : id);

  // Domaines de diffusion. Un nœud = une interface de PC, serveur, routeur ou pare-feu
  // (une sous-interface VLAN est un nœud à part), ou un VLAN d'un switch (« sw1#10 ») :
  // un switch recopie une diffusion sur tous ses ports du même VLAN.
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (x, y) => parent.set(find(x), find(y));
  const ALL = 'all';
  /** Ce que porte une extrémité de câble : nœud sans étiquette, et nœud par VLAN étiqueté. */
  const sideOf = (end) => {
    const def = devices.get(end.device);
    if (def && def.type === 'switch') {
      const config = (def.ports || {})[end.iface] || {};
      if (config.mode === 'trunk') {
        const native = config.native || 1;
        return { untagged: `${def.id}#${native}`, tagged: config.allowed ? config.allowed.filter((v) => v !== native) : ALL, node: (v) => `${def.id}#${v}`, vlans: Object.keys(def.vlans || {}).map(Number) };
      }
      return { untagged: `${def.id}#${config.vlan || 1}`, tagged: [], node: null, vlans: [] };
    }
    const subs = ((def && def.interfaces) || []).filter((iface) => iface.name.startsWith(`${end.iface}.`));
    return { untagged: `${end.device}:${end.iface}`, tagged: subs.map((iface) => iface.vlan), node: (v) => `${end.device}:${(subs.find((iface) => iface.vlan === v) || {}).name}`, vlans: [] };
  };
  for (const link of links) {
    const a = sideOf(parseEndpoint(link.a));
    const b = sideOf(parseEndpoint(link.b));
    union(a.untagged, b.untagged);
    let shared = [];
    if (a.tagged === ALL && b.tagged === ALL) shared = [...new Set([...a.vlans, ...b.vlans])].filter((v) => v !== 1);
    else if (a.tagged === ALL) shared = b.tagged;
    else if (b.tagged === ALL) shared = a.tagged;
    else shared = a.tagged.filter((v) => b.tagged.includes(v));
    for (const vlan of shared) union(a.node(vlan), b.node(vlan));
  }

  // Interfaces adressées, avec leur domaine.
  const addressed = [];
  for (const def of scenario.devices) {
    for (const iface of def.interfaces || []) {
      if (!iface.ip || !isIp(iface.ip)) continue;
      addressed.push({ def, iface, domain: find(`${def.id}:${iface.name}`), network: networkOf(iface.ip, iface.prefix) });
    }
  }
  const cabled = new Set(links.flatMap((link) => [parseEndpoint(link.a).device, parseEndpoint(link.b).device]));
  return { devices, links, nameOf, addressed, domainOf: (id, iface) => find(`${id}:${iface}`), cabled };
}

/** Première adresse libre du réseau `ip`/`prefix` (en évitant .1, souvent le routeur). */
export function freeAddress(scenario, network, prefix, taken = new Set()) {
  const used = new Set([...taken]);
  for (const def of scenario.devices) for (const iface of def.interfaces || []) if (iface.ip) used.add(iface.ip);
  for (const def of scenario.devices) {
    const dhcp = def.services && def.services.dhcp;
    if (dhcp && dhcp.start && dhcp.end) for (let n = ipToInt(dhcp.start); n <= ipToInt(dhcp.end); n++) used.add(intToIp(n));
  }
  const base = ipToInt(networkOf(network, prefix));
  const size = 2 ** (32 - prefix);
  for (let offset = 10; offset < size - 1; offset++) {
    const candidate = intToIp(base + offset);
    if (!used.has(candidate)) return candidate;
  }
  for (let offset = 2; offset < Math.min(10, size - 1); offset++) {
    const candidate = intToIp(base + offset);
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------- règles

function addressingRules(scenario, view, out) {
  const { addressed } = view;
  // Adresses IP en double
  const byIp = new Map();
  for (const entry of addressed) {
    if (!byIp.has(entry.iface.ip)) byIp.set(entry.iface.ip, []);
    byIp.get(entry.iface.ip).push(entry);
  }
  for (const [ip, owners] of byIp) {
    if (owners.length < 2) continue;
    const last = owners.at(-1);
    const free = freeAddress(scenario, ip, last.iface.prefix);
    out.push(finding('addressing', 'error', 'dupIp', { ip, names: listNames(owners.map((o) => o.def.name)), name: last.def.name, free: free || '—' }, {
      subject: ip, devices: owners.map((o) => o.def.id),
      fix: free ? { op: 'setIp', device: last.def.id, iface: last.iface.name, ip: free, prefix: last.iface.prefix } : null,
    }));
  }
  // Adresses MAC en double
  const byMac = new Map();
  for (const def of scenario.devices) for (const iface of def.interfaces || []) {
    if (!iface.mac) continue;
    const mac = iface.mac.toUpperCase();
    if (!byMac.has(mac)) byMac.set(mac, []);
    byMac.get(mac).push({ def, iface });
  }
  for (const [mac, owners] of byMac) {
    if (owners.length < 2) continue;
    const last = owners.at(-1);
    out.push(finding('addressing', 'error', 'dupMac', { mac, names: listNames(owners.map((o) => o.def.name)), name: last.def.name }, {
      subject: mac, devices: owners.map((o) => o.def.id),
      fix: { op: 'setMac', device: last.def.id, iface: last.iface.name, mac: freeMac(scenario) },
    }));
  }
  // PC ou serveur sans adresse
  const dhcpServers = scenario.devices.filter((def) => def.services && def.services.dhcp);
  for (const def of scenario.devices) {
    if (def.type !== 'host' && def.type !== 'server') continue;
    const iface = (def.interfaces || [])[0];
    if (!iface || iface.ip) continue;
    if (!view.cabled.has(def.id)) continue; // déjà signalé comme isolé
    const domain = view.domainOf(def.id, iface.name);
    const server = dhcpServers.find((srv) => (srv.interfaces || []).some((it) => it.ip && view.domainOf(srv.id, it.name) === domain));
    if (server && scenario.protocols && scenario.protocols.includes('dhcp')) {
      out.push(finding('addressing', 'info', 'dhcpWait', { name: def.name, server: server.name }, { subject: def.id, devices: [def.id, server.id] }));
      continue;
    }
    const neighbour = addressed.find((entry) => entry.domain === domain);
    if (!neighbour) continue;
    const free = freeAddress(scenario, neighbour.iface.ip, neighbour.iface.prefix);
    const router = addressed.find((entry) => entry.domain === domain && isRouting(entry.def));
    out.push(finding('addressing', 'error', 'noIp', { name: def.name, free, prefix: neighbour.iface.prefix }, {
      subject: def.id, devices: [def.id],
      fix: free ? { op: 'setIp', device: def.id, iface: iface.name, ip: free, prefix: neighbour.iface.prefix, gateway: router ? router.iface.ip : undefined } : null,
    }));
  }
  // Deux réseaux IP dans le même domaine de diffusion (sans routeur entre eux)
  const seenPairs = new Set();
  for (const a of addressed) {
    if (isRouting(a.def)) continue;
    for (const b of addressed) {
      if (b === a || isRouting(b.def) || a.domain !== b.domain || a.network === b.network) continue;
      // On ne signale que le poste qui n'est pas dans le réseau majoritaire du domaine.
      const domainNets = addressed.filter((e) => e.domain === a.domain).map((e) => e.network);
      const count = (net) => domainNets.filter((n) => n === net).length;
      if (count(a.network) < count(b.network) || (count(a.network) === count(b.network) && a.def.id > b.def.id)) continue;
      const key = b.def.id;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const free = freeAddress(scenario, a.iface.ip, a.iface.prefix);
      const gateway = addressed.find((e) => e.domain === a.domain && isRouting(e.def) && e.network === a.network);
      out.push(finding('addressing', 'warning', 'mixedSubnets', {
        a: a.def.name, b: b.def.name, na: `${a.network}/${a.iface.prefix}`, nb: `${b.network}/${b.iface.prefix}`, free,
      }, {
        subject: key, devices: [a.def.id, b.def.id],
        fix: free ? { op: 'setIp', device: b.def.id, iface: b.iface.name, ip: free, prefix: a.iface.prefix, gateway: b.def.gateway ? (gateway ? gateway.iface.ip : undefined) : undefined } : null,
      }));
    }
  }
}

function freeMac(scenario) {
  const used = new Set(scenario.devices.flatMap((def) => (def.interfaces || []).map((iface) => (iface.mac || '').toUpperCase())));
  for (let n = 0x10; n < 0xffff; n++) {
    const mac = `02:00:00:00:${((n >> 8) & 255).toString(16).padStart(2, '0')}:${(n & 255).toString(16).padStart(2, '0')}`.toUpperCase();
    if (!used.has(mac)) return mac;
  }
  return '02:00:00:00:FF:FF';
}

function gatewayRules(scenario, view, out) {
  const { addressed } = view;
  const networks = [...new Set(addressed.filter((e) => !isRouting(e.def)).map((e) => `${e.network}/${e.iface.prefix}`))];
  for (const def of scenario.devices) {
    if (def.type !== 'host' && def.type !== 'server') continue;
    const mine = addressed.find((e) => e.def === def);
    if (!mine) continue;
    const router = addressed.find((e) => isRouting(e.def) && e.domain === mine.domain && e.network === mine.network);
    const params = { name: def.name, gateway: def.gateway, network: mine.network, prefix: mine.iface.prefix,
      suggest: router ? router.iface.ip : '—', router: router ? router.def.name : '—' };
    const fix = router ? { op: 'setGateway', device: def.id, gateway: router.iface.ip } : null;
    if (def.gateway) {
      if (!inNetwork(def.gateway, mine.iface.ip, mine.iface.prefix)) {
        out.push(finding('gateway', 'error', 'gwOutside', params, { subject: def.id, devices: [def.id, ...(router ? [router.def.id] : [])], fix }));
        continue;
      }
      const owner = addressed.find((e) => e.iface.ip === def.gateway);
      if (!owner || !isRouting(owner.def)) {
        params.owner = owner
          ? { fr: `est l'adresse de ${owner.def.name}, qui n'est pas un routeur`, en: `is the address of ${owner.def.name}, which is not a router` }
          : { fr: 'n\'appartient à aucun équipement', en: 'belongs to no device' };
        out.push(finding('gateway', 'error', 'gwNotRouter', params, { subject: def.id, devices: [def.id, ...(owner ? [owner.def.id] : [])], fix }));
      }
    } else if (router && networks.length > 1) {
      const others = networks.filter((n) => n !== `${mine.network}/${mine.iface.prefix}`);
      out.push(finding('gateway', 'warning', 'gwMissing', { ...params, others: others.join(', ') }, { subject: def.id, devices: [def.id, router.def.id], fix }));
    }
  }
}

function routingRules(scenario, view, out) {
  const { addressed } = view;
  const routers = scenario.devices.filter(isRouting);
  if (!routers.length) return;
  // Réseaux qui contiennent des PC ou serveurs.
  const targets = new Map();
  for (const e of addressed) {
    if (isRouting(e.def)) continue;
    const key = `${e.network}/${e.iface.prefix}`;
    if (!targets.has(key)) targets.set(key, { network: e.network, prefix: e.iface.prefix, hosts: [] });
    targets.get(key).hosts.push(e.def.name);
  }
  const connected = (router) => addressed.filter((e) => e.def === router);
  const knows = (router, network, prefix) => connected(router).some((e) => e.network === networkOf(network, e.iface.prefix) && e.iface.prefix <= prefix)
    || (router.routes || []).some((r) => r.prefix === 0 || (r.prefix <= prefix && inNetwork(network, r.network, r.prefix)));

  // Routeurs voisins : partagent un domaine et un réseau.
  const neighbours = (router) => {
    const result = [];
    for (const mine of connected(router)) {
      for (const other of addressed) {
        if (other.def === router || !isRouting(other.def)) continue;
        if (other.domain === mine.domain && other.network === mine.network) result.push({ router: other.def, via: other.iface.ip });
      }
    }
    return result;
  };
  // Prochain saut vers `target` : le voisin le plus proche (en sauts) d'un routeur qui y est branché.
  const nextHop = (router, target) => {
    const start = neighbours(router);
    const queue = start.map((n) => ({ ...n, first: n }));
    const seen = new Set([router.id]);
    while (queue.length) {
      const item = queue.shift();
      if (seen.has(item.router.id)) continue;
      seen.add(item.router.id);
      if (connected(item.router).some((e) => e.network === target.network && e.iface.prefix === target.prefix)) return item.first;
      for (const n of neighbours(item.router)) queue.push({ ...n, first: item.first });
    }
    return null;
  };

  for (const router of routers) {
    if (!view.cabled.has(router.id)) continue;
    for (const [key, target] of targets) {
      if (knows(router, target.network, target.prefix)) continue;
      // Un routeur qui ne voit aucun chemin vers ce réseau n'a rien à corriger ici :
      // c'est le câblage qui manque (signalé ailleurs) — sauf s'il a des voisins.
      const hop = nextHop(router, target);
      if (!hop && !neighbours(router).length) continue;
      // Réseau privé caché derrière un NAT : vu de l'extérieur, il n'a pas à être routé.
      if (hop && addressed.some((e) => e.iface.ip === hop.via && e.iface.nat === 'outside')) continue;
      out.push(finding('routing', 'error', 'noRoute', {
        router: router.name, network: target.network, prefix: target.prefix, hosts: listNames(target.hosts.slice(0, 3)),
        via: hop ? hop.via : '—', next: hop ? hop.router.name : '—',
      }, {
        subject: `${router.id}>${key}`, devices: [router.id], manual: !hop,
        fix: hop ? { op: 'addRoute', device: router.id, route: { network: target.network, prefix: target.prefix, via: hop.via } } : null,
      }));
    }
    for (const route of router.routes || []) {
      if (connected(router).some((e) => inNetwork(route.via, e.iface.ip, e.iface.prefix))) continue;
      out.push(finding('routing', 'error', 'badVia', { router: router.name, network: route.network, prefix: route.prefix, via: route.via }, {
        subject: `${router.id}>${route.network}`, devices: [router.id],
      }));
    }
  }
}

function cablingRules(scenario, view, out) {
  const { devices, links, nameOf } = view;
  // Équipements isolés
  for (const def of scenario.devices) {
    if (!view.cabled.has(def.id)) out.push(finding('cabling', 'warning', 'isolated', { name: def.name }, { subject: def.id, devices: [def.id] }));
  }
  // Boucles entre switchs : un câble qui relie deux switchs déjà reliés par ailleurs.
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const link of links) {
    const a = parseEndpoint(link.a).device;
    const b = parseEndpoint(link.b).device;
    if (!devices.get(a) || !devices.get(b) || devices.get(a).type !== 'switch' || devices.get(b).type !== 'switch') continue;
    if (find(a) === find(b)) {
      const members = [...parent.keys()].filter((id) => find(id) === find(a));
      out.push(finding('cabling', 'error', 'loop', { names: listNames(members.map(nameOf)), link: link.id }, {
        subject: link.id, devices: members, links: [link.id], fix: { op: 'removeLink', link: link.id },
      }));
      continue;
    }
    parent.set(find(a), find(b));
  }
  // Ports et câbles
  for (const link of links) {
    const a = parseEndpoint(link.a);
    const b = parseEndpoint(link.b);
    const defA = devices.get(a.device);
    const defB = devices.get(b.device);
    if (!defA || !defB) continue;
    const cable = CABLES[link.cable || DEFAULT_CABLE];
    const length = link.length || DEFAULT_LENGTH;
    if (length > cable.reach) {
      out.push(finding('cabling', 'error', 'cableReach', { link: link.id, length, cable: cable.name, reach: cable.reach }, {
        subject: link.id, links: [link.id], devices: [a.device, b.device], fix: length <= CABLES.fibre.reach ? { op: 'setCable', link: link.id, cable: 'fibre' } : null,
      }));
    }
    for (const [def, end] of [[defA, a], [defB, b]]) {
      if (def.type !== 'switch' && !isRouting(def)) continue;
      const model = modelOf(def);
      const names = portNames(model);
      if (!def.model || names.includes(end.iface)) continue;
      const used = new Set(links.flatMap((l) => [l.a, l.b]).filter((e) => e.startsWith(def.id + ':')).map((e) => e.split(':')[1]));
      const free = names.find((n) => !used.has(n));
      out.push(finding('cabling', 'warning', 'unknownPort', { port: end.iface, model: model.name, name: def.name, ports: `${names[0]}…${names.at(-1)}`, link: link.id, free: free || '—' }, {
        subject: `${link.id}:${def.id}`, links: [link.id], devices: [def.id],
        fix: free ? { op: 'movePort', link: link.id, device: def.id, from: end.iface, to: free } : null,
      }));
    }
  }
}

function performanceRules(scenario, view, out, traffic) {
  const { devices, links } = view;
  const speeds = new Map();
  for (const link of links) {
    const a = parseEndpoint(link.a);
    const b = parseEndpoint(link.b);
    const defA = devices.get(a.device);
    const defB = devices.get(b.device);
    if (!defA || !defB) continue;
    const s = linkSpeed(defA, a.iface, defB, b.iface, link.cable, link.length);
    speeds.set(link.id, { ...s, a, b, defA, defB });
    if (s.limitedBy === 'cable') {
      const cards = Math.min(s.speedA, s.speedB);
      const better = cards > 1000 ? 'cat6a' : 'cat6';
      out.push(finding('performance', 'warning', 'cableLimit', {
        link: link.id, cards: formatSpeed(cards), cable: CABLES[link.cable || DEFAULT_CABLE].name, speed: formatSpeed(s.speed), better: CABLES[better].name,
      }, { subject: link.id, links: [link.id], devices: [a.device, b.device], fix: { op: 'setCable', link: link.id, cable: better } }));
    } else if (s.limitedBy) {
      const slowDef = s.limitedBy === 'a' ? defA : defB;
      const fastDef = s.limitedBy === 'a' ? defB : defA;
      const better = Object.entries(MODELS).find(([, m]) => m.type === slowDef.type && m.ports[0].speed >= Math.max(s.speedA, s.speedB));
      out.push(finding('performance', 'info', 'cardLimit', {
        name: slowDef.name, link: link.id, slow: formatSpeed(s.speed), other: fastDef.name, fast: formatSpeed(Math.max(s.speedA, s.speedB)),
        model: better ? better[1].name : '—',
      }, {
        subject: `${link.id}:${slowDef.id}`, links: [link.id], devices: [slowDef.id],
        fix: better && !(slowDef.interfaces || []).some((iface) => iface.speed) ? { op: 'setModel', device: slowDef.id, model: better[0] } : null,
      }));
    }
  }
  // Goulot vers un serveur : le lien du serveur est plus lent que la somme des postes qui
  // partagent son domaine (au moins deux postes aussi rapides que lui).
  for (const def of scenario.devices) {
    if (def.type !== 'server') continue;
    const own = [...speeds.values()].find((s) => s.a.device === def.id || s.b.device === def.id);
    if (!own || own.limitedBy) continue; // un lien bridé est déjà signalé plus haut
    const domain = view.domainOf(def.id, (own.a.device === def.id ? own.a : own.b).iface);
    const clients = [...speeds.values()].filter((s) => {
      const end = s.defA.type === 'host' ? s.a : s.defB.type === 'host' ? s.b : null;
      return end && view.domainOf(end.device, end.iface) === domain;
    });
    const total = clients.reduce((sum, s) => sum + s.speed, 0);
    const fastest = Math.max(0, ...clients.map((s) => s.speed));
    // Signalé seulement si un poste va plus vite que le serveur, ou si au moins trois
    // postes rapides le partagent : deux postes sur un serveur Gigabit, c'est normal.
    if (fastest > own.speed || (clients.length >= 3 && total > own.speed && fastest >= own.speed)) {
      out.push(finding('performance', 'info', 'serverBottleneck', { name: def.name, speed: formatSpeed(own.speed), clients: clients.length, client: formatSpeed(fastest) }, {
        subject: def.id, devices: [def.id],
        links: links.filter((l) => l.a.startsWith(def.id + ':') || l.b.startsWith(def.id + ':')).map((l) => l.id),
      }));
    }
  }
  // État vivant (si fourni) : charge et pertes.
  if (traffic) {
    for (const [id, link] of Object.entries(traffic.links || {})) {
      if (link.max >= LOAD_LEVELS.saturated) {
        const ends = links.find((l) => l.id === id);
        const queue = ends ? Math.max(...[ends.a, ends.b].map((k) => (traffic.ports[k] ? traffic.ports[k].maxQueue : 0))) : 0;
        out.push(finding('performance', 'warning', 'saturated', { link: id, load: Math.round(link.max * 100), queue }, { subject: id, links: [id] }));
      }
      if (link.lost > 0) out.push(finding('performance', 'info', 'losses', { link: id, lost: link.lost }, { subject: id, links: [id] }));
    }
  }
}

function serviceRules(scenario, view, out) {
  const { addressed } = view;
  const dnsServers = scenario.devices.filter((def) => def.services && def.services.dns);
  for (const def of scenario.devices) {
    if (!def.dns) continue;
    if (addressed.some((e) => e.iface.ip === def.dns)) continue;
    const server = dnsServers[0];
    const ip = server && addressed.find((e) => e.def === server);
    out.push(finding('services', 'error', 'dnsMissing', { name: def.name, dns: def.dns, suggest: ip ? ip.iface.ip : '—', server: server ? server.name : '—' }, {
      subject: def.id, devices: [def.id], manual: !ip,
      fix: { op: 'setDns', device: def.id, dns: ip ? ip.iface.ip : null },
    }));
  }
}

const RULES = [addressingRules, gatewayRules, routingRules, cablingRules, serviceRules, performanceRules];
const ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Diagnostic complet d'un scénario.
 * @param {Object} scenario  topologie (format des fichiers scenarios/*.json)
 * @param {Object} [options] { traffic } : état vivant fourni par sim.traffic()
 * @returns {{ findings: Array, counts: { error, warning, info }, healthy: boolean }}
 */
export function diagnose(scenario, { traffic = null } = {}) {
  const view = analyse(scenario);
  const out = [];
  for (const rule of RULES) rule(scenario, view, out, traffic);
  // Doublons éventuels (même constat trouvé deux fois) puis tri par gravité.
  const unique = [...new Map(out.map((f) => [f.id, f])).values()];
  unique.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of unique) counts[f.severity] += 1;
  const healthy = counts.error === 0 && counts.warning === 0;
  if (!unique.length) unique.push(finding('summary', 'info', 'healthy', {}, { subject: 'ok' }));
  return { findings: unique, counts, healthy };
}

/**
 * Applique une correction à une COPIE du scénario (l'original n'est jamais modifié).
 * Les étapes du scénario sont gardées : on peut rejouer aussitôt.
 */
export function applyFix(scenario, fix) {
  const copy = structuredClone(scenario);
  const device = fix.device ? copy.devices.find((def) => def.id === fix.device) : null;
  const iface = device && fix.iface ? (device.interfaces || []).find((it) => it.name === fix.iface) : null;
  switch (fix.op) {
    case 'setIp':
      iface.ip = fix.ip;
      iface.prefix = fix.prefix;
      if (fix.gateway) device.gateway = fix.gateway;
      break;
    case 'setMac': iface.mac = fix.mac; break;
    case 'setGateway': device.gateway = fix.gateway; break;
    case 'setDns':
      if (fix.dns) device.dns = fix.dns;
      else delete device.dns;
      break;
    case 'addRoute': device.routes = [...(device.routes || []), fix.route]; break;
    case 'removeLink': copy.links = copy.links.filter((link) => link.id !== fix.link); break;
    case 'setCable': copy.links.find((link) => link.id === fix.link).cable = fix.cable; break;
    case 'setModel': device.model = fix.model; break;
    case 'movePort': {
      const link = copy.links.find((l) => l.id === fix.link);
      for (const side of ['a', 'b']) if (link[side] === `${fix.device}:${fix.from}`) link[side] = `${fix.device}:${fix.to}`;
      break;
    }
    default: throw new Error(`Correction inconnue : ${fix.op}`);
  }
  return copy;
}

/** Description courte d'une correction, pour le bouton (texte { fr, en }). */
export function describeFix(fix) {
  const d = {
    setIp: [`Adresse ${fix.ip}/${fix.prefix}`, `Address ${fix.ip}/${fix.prefix}`],
    setMac: [`MAC ${fix.mac}`, `MAC ${fix.mac}`],
    setGateway: [`Passerelle ${fix.gateway}`, `Gateway ${fix.gateway}`],
    setDns: fix.dns ? [`DNS ${fix.dns}`, `DNS ${fix.dns}`] : ['Retirer le DNS', 'Remove the DNS setting'],
    addRoute: fix.route ? [`Route ${fix.route.network}/${fix.route.prefix} via ${fix.route.via}`, `Route ${fix.route.network}/${fix.route.prefix} via ${fix.route.via}`] : ['', ''],
    removeLink: [`Retirer le câble ${fix.link}`, `Remove cable ${fix.link}`],
    setCable: [`Câble ${CABLES[fix.cable] ? CABLES[fix.cable].name : fix.cable}`, `${CABLES[fix.cable] ? CABLES[fix.cable].name : fix.cable} cable`],
    setModel: [`Modèle ${MODELS[fix.model] ? MODELS[fix.model].name : fix.model}`, `Model ${MODELS[fix.model] ? MODELS[fix.model].name : fix.model}`],
    movePort: [`Port ${fix.to}`, `Port ${fix.to}`],
  }[fix.op] || [fix.op, fix.op];
  return { fr: d[0], en: d[1] };
}
