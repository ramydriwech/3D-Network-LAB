// Catalogue des équipements et des câbles (demande du superviseur : caractéristiques et débit).
//
// Les modèles sont GÉNÉRIQUES et FICTIFS : aucune marque ni référence réelle. Leurs valeurs
// sont réalistes pour du matériel d'entreprise courant. Les chiffres de performance ne
// sont pas recopiés d'une fiche : ils sont CALCULÉS à partir des ports (voir specsOf), comme
// le font les constructeurs — on peut donc vérifier chaque valeur à la main.
//
// Un scénario choisit un modèle par équipement ("model": "sw-8g") et un câble par lien
// ("cable": "cat5"). Sans précision, le modèle par défaut du type et un câble Cat 6 sont
// utilisés. Une interface peut aussi imposer sa vitesse ("speed": 100, en Mb/s).

/** Vitesses Ethernet usuelles, en Mb/s. */
export const ETHERNET_SPEEDS = Object.freeze([10, 100, 1000, 10000]);

/** Octets « invisibles » d'une trame sur le câble : préambule (8) + intervalle inter-trames (12). */
export const WIRE_OVERHEAD = 20;
/** Plus petite trame Ethernet, en octets (en-têtes et FCS compris). */
export const MIN_FRAME = 64;

/**
 * Ports d'un modèle : liste de groupes { prefix, from, count, speed }.
 * Les noms sont prefix + numéro, ex. { prefix: 'p', from: 1, count: 8 } → p1 … p8.
 */
export const MODELS = Object.freeze({
  'pc-std': {
    type: 'host', name: 'Poste de travail NX-1',
    description: { fr: 'Ordinateur de bureau avec carte réseau Gigabit.', en: 'Desktop computer with a Gigabit network card.' },
    ports: [{ prefix: 'eth', from: 0, count: 1, speed: 1000 }],
    power: 65,
  },
  'pc-fe': {
    type: 'host', name: 'Poste ancien NX-0',
    description: { fr: 'Ancien poste dont la carte réseau ne dépasse pas 100 Mb/s (Fast Ethernet).', en: 'Older computer whose network card tops out at 100 Mb/s (Fast Ethernet).' },
    ports: [{ prefix: 'eth', from: 0, count: 1, speed: 100 }],
    power: 80,
  },
  'srv-1g': {
    type: 'server', name: 'Serveur SV-2',
    description: { fr: 'Serveur en baie, deux ports Gigabit.', en: 'Rack server with two Gigabit ports.' },
    ports: [{ prefix: 'eth', from: 0, count: 2, speed: 1000 }],
    power: 350,
  },
  'srv-10g': {
    type: 'server', name: 'Serveur SV-4X',
    description: { fr: 'Serveur en baie avec deux ports 10 Gb/s, pour les services très sollicités.', en: 'Rack server with two 10 Gb/s ports, for heavily used services.' },
    ports: [{ prefix: 'eth', from: 0, count: 2, speed: 10000 }],
    power: 450,
  },
  'sw-8g': {
    type: 'switch', name: 'Commutateur CX-8G',
    description: { fr: 'Switch d\'accès non administrable, 8 ports Gigabit.', en: 'Unmanaged access switch, 8 Gigabit ports.' },
    ports: [{ prefix: 'p', from: 1, count: 8, speed: 1000 }],
    macTable: 8192,
    power: 12,
  },
  'sw-8f': {
    type: 'switch', name: 'Commutateur CX-8F',
    description: { fr: 'Ancien switch Fast Ethernet : 8 ports à 100 Mb/s seulement.', en: 'Older Fast Ethernet switch: 8 ports at only 100 Mb/s.' },
    ports: [{ prefix: 'p', from: 1, count: 8, speed: 100 }],
    macTable: 4096,
    power: 8,
  },
  'sw-24g': {
    type: 'switch', name: 'Commutateur CX-24G',
    description: { fr: 'Switch de distribution : 24 ports Gigabit et 2 ports montants à 10 Gb/s.', en: 'Distribution switch: 24 Gigabit ports and 2 uplink ports at 10 Gb/s.' },
    ports: [{ prefix: 'p', from: 1, count: 24, speed: 1000 }, { prefix: 'u', from: 1, count: 2, speed: 10000 }],
    macTable: 16384,
    power: 35,
  },
  'rt-2g': {
    type: 'router', name: 'Routeur RX-2G',
    description: { fr: 'Routeur d\'agence, 2 interfaces Gigabit.', en: 'Branch router, 2 Gigabit interfaces.' },
    ports: [{ prefix: 'g0/', from: 0, count: 2, speed: 1000 }],
    routing: 1000,
    power: 40,
    os: 'netcore',
  },
  'rt-4g': {
    type: 'router', name: 'Routeur RX-4G',
    description: { fr: 'Routeur de site, 4 interfaces Gigabit.', en: 'Site router, 4 Gigabit interfaces.' },
    ports: [{ prefix: 'g0/', from: 0, count: 4, speed: 1000 }],
    routing: 4000,
    power: 90,
    os: 'netcore',
  },
  // --- Laboratoire (S6) : équipements administrables, avec une console.
  'sw-24m': {
    type: 'switch', name: 'Commutateur administrable CX-24M',
    description: {
      fr: 'Switch d\'accès administrable : 24 ports Gigabit et 2 ports montants 10 Gb/s. Sa console (style IOS) permet de créer des VLAN, de passer un port en accès ou en trunk 802.1Q, de sécuriser un port (adresses MAC autorisées, apprentissage « sticky ») et de lire sa table MAC. C\'est le switch typique d\'une salle de cours ou d\'un étage de bureaux.',
      en: 'Managed access switch: 24 Gigabit ports and 2 10 Gb/s uplinks. Its console (IOS style) creates VLANs, sets ports to access or 802.1Q trunk, secures a port (allowed MAC addresses, sticky learning) and shows its MAC table. The typical switch of a classroom or an office floor.',
    },
    ports: [{ prefix: 'p', from: 1, count: 24, speed: 1000 }, { prefix: 'u', from: 1, count: 2, speed: 10000 }],
    macTable: 16384, vlans: 1024,
    power: 30, os: 'netcore',
  },
  'sw-24v': {
    type: 'switch', name: 'Commutateur administrable VS-24',
    description: {
      fr: 'Switch administrable de la gamme Versa : 24 ports Gigabit et 2 ports 10 Gb/s. Mêmes possibilités que le CX-24M (VLAN, trunk, sécurité des ports), mais sa console suit le style VRP (system-view, display…) : utile pour s\'entraîner aux deux familles de commandes.',
      en: 'Managed switch of the Versa range: 24 Gigabit ports and 2 10 Gb/s ports. Same features as the CX-24M (VLANs, trunks, port security), but its console follows the VRP style (system-view, display…): handy to practise both command families.',
    },
    ports: [{ prefix: 'p', from: 1, count: 24, speed: 1000 }, { prefix: 'u', from: 1, count: 2, speed: 10000 }],
    macTable: 16384, vlans: 4094,
    power: 32, os: 'versa',
  },
  'rt-2v': {
    type: 'router', name: 'Routeur VR-2',
    description: {
      fr: 'Routeur d\'agence de la gamme Versa, 2 interfaces Gigabit, console de style VRP. Routage statique, sous-interfaces 802.1Q (routage entre VLAN), listes d\'accès et NAT.',
      en: 'Versa branch router, 2 Gigabit interfaces, VRP-style console. Static routing, 802.1Q sub-interfaces (inter-VLAN routing), access lists and NAT.',
    },
    ports: [{ prefix: 'g0/0/', from: 0, count: 2, speed: 1000 }],
    routing: 2000,
    power: 45, os: 'versa',
  },
  'fw-3g': {
    type: 'firewall', name: 'Pare-feu SG-3',
    description: {
      fr: 'Pare-feu à états pour une petite entreprise : 3 interfaces Gigabit, une par zone (inside, outside, dmz). Ce qui part de l\'intérieur peut revenir ; ce qui arrive d\'Internet est bloqué sauf règle explicite. Fait aussi le NAT pour partager une adresse publique.',
      en: 'Stateful firewall for a small company: 3 Gigabit interfaces, one per zone (inside, outside, dmz). What leaves from inside may come back; what arrives from the Internet is blocked unless a rule allows it. Also does NAT to share one public address.',
    },
    ports: [{ prefix: 'g0/', from: 0, count: 3, speed: 1000 }],
    routing: 1000, sessions: 50000,
    power: 25, os: 'shield',
  },
  'fw-8g': {
    type: 'firewall', name: 'Pare-feu SG-8X',
    description: {
      fr: 'Pare-feu de site : 8 interfaces Gigabit pour séparer plusieurs zones (bureaux, serveurs, invités, Internet) et beaucoup plus de sessions simultanées que le SG-3.',
      en: 'Site firewall: 8 Gigabit interfaces to separate several zones (offices, servers, guests, Internet) and many more simultaneous sessions than the SG-3.',
    },
    ports: [{ prefix: 'g0/', from: 0, count: 8, speed: 1000 }],
    routing: 8000, sessions: 500000,
    power: 60, os: 'shield',
  },
});

/** Modèle utilisé quand le scénario n'en précise pas. */
export const DEFAULT_MODEL = Object.freeze({ host: 'pc-std', server: 'srv-1g', switch: 'sw-8g', router: 'rt-2g', firewall: 'fw-3g' });

/**
 * Systèmes d'exploitation (fictifs) des équipements administrables, et le style de leurs
 * commandes : « ios » ressemble à Cisco IOS (enable, configure terminal, show…), « vrp »
 * à Huawei VRP (system-view, display…). Voir src/sim/cli.js.
 */
export const SYSTEMS = Object.freeze({
  'netcore': { name: 'NetCore OS 15', dialect: 'ios' },
  'versa': { name: 'Versa NOS 8', dialect: 'vrp' },
  'shield': { name: 'Shield OS 9', dialect: 'ios' },
  'desk': { name: 'Bureau (invite de commandes)', dialect: 'pc' },
});

/** Système d'un équipement : celui de son modèle ; un PC ou un serveur a une invite de commandes. */
export function systemOf(def) {
  const model = modelOf(def);
  return SYSTEMS[(model && model.os) || (def.type === 'host' || def.type === 'server' ? 'desk' : 'netcore')];
}

/**
 * Câbles. `max` : vitesse maximale (Mb/s) ; `long` : vitesse au-delà de `shortUntil` mètres
 * (le Cat 6 ne tient 10 Gb/s que sur 55 m) ; `reach` : longueur maximale en mètres.
 */
export const CABLES = Object.freeze({
  cat5: {
    name: 'Cat 5', max: 100, reach: 100,
    description: { fr: 'Ancien câble en cuivre à paires torsadées : il ne dépasse pas 100 Mb/s (Fast Ethernet).', en: 'Older twisted-pair copper cable: it cannot go beyond 100 Mb/s (Fast Ethernet).' },
  },
  cat5e: {
    name: 'Cat 5e', max: 1000, reach: 100,
    description: { fr: 'Version améliorée du Cat 5 : le minimum pour un réseau Gigabit.', en: 'Enhanced Cat 5: the minimum for a Gigabit network.' },
  },
  cat6: {
    name: 'Cat 6', max: 10000, shortUntil: 55, long: 1000, reach: 100,
    description: { fr: "Le câble le plus courant aujourd'hui : 10 Gb/s sur de courtes distances, 1 Gb/s au-delà de 55 m.", en: 'The most common cable today: 10 Gb/s over short runs, 1 Gb/s beyond 55 m.' },
  },
  cat6a: {
    name: 'Cat 6a', max: 10000, reach: 100,
    description: { fr: 'Cat 6 « augmenté », mieux protégé des perturbations : 10 Gb/s sur toute la longueur.', en: '"Augmented" Cat 6, better shielded from interference: 10 Gb/s over the full length.' },
  },
  fibre: {
    name: 'Fibre multimode OM3', max: 10000, reach: 300,
    description: { fr: 'La lumière circule dans une fibre de verre : longues distances, insensible aux perturbations électriques.', en: 'Light travels through a glass fibre: long distances, immune to electrical interference.' },
  },
});

/** Résumé chiffré d'un câble : « jusqu'à 10 Gb/s (1 Gb/s au-delà de 55 m) · 100 m maximum ». */
export function cableSummary(cableId) {
  const cable = CABLES[cableId] || CABLES[DEFAULT_CABLE];
  const tail = cable.shortUntil ? { fr: ` (${formatSpeed(cable.long)} au-delà de ${cable.shortUntil} m)`, en: ` (${formatSpeed(cable.long)} beyond ${cable.shortUntil} m)` } : { fr: '', en: '' };
  return {
    fr: `jusqu'à ${formatSpeed(cable.max)}${tail.fr} · ${cable.reach} m maximum`,
    en: `up to ${formatSpeed(cable.max)}${tail.en} · ${cable.reach} m maximum`,
  };
}
export const DEFAULT_CABLE = 'cat6';
/** Longueur supposée d'un câble quand le scénario ne la donne pas, en mètres. */
export const DEFAULT_LENGTH = 10;

/** Modèle d'un équipement (objet du catalogue), avec repli sur le modèle par défaut du type. */
export function modelOf(def) {
  return MODELS[def.model] || MODELS[DEFAULT_MODEL[def.type]] || null;
}

/** Identifiant du modèle effectivement utilisé. */
export function modelIdOf(def) {
  return MODELS[def.model] ? def.model : DEFAULT_MODEL[def.type];
}

/** Liste des noms de ports d'un modèle, dans l'ordre. */
export function portNames(model) {
  const names = [];
  for (const group of (model && model.ports) || []) {
    for (let i = 0; i < group.count; i++) names.push(group.prefix + (group.from + i));
  }
  return names;
}

/** Vitesse nominale (Mb/s) d'un port d'après le modèle ; null si le port n'existe pas. */
export function modelPortSpeed(model, portName) {
  for (const group of (model && model.ports) || []) {
    for (let i = 0; i < group.count; i++) {
      if (group.prefix + (group.from + i) === portName) return group.speed;
    }
  }
  return null;
}

/**
 * Vitesse d'une interface : celle imposée par le scénario, sinon celle du port du modèle,
 * sinon la vitesse du premier groupe de ports du modèle (port non répertorié), sinon 1 Gb/s.
 */
export function interfaceSpeed(def, ifaceName) {
  const declared = (def.interfaces || []).find((iface) => iface.name === ifaceName);
  if (declared && declared.speed) return declared.speed;
  const model = modelOf(def);
  return modelPortSpeed(model, ifaceName)
    || (model && model.ports[0] ? model.ports[0].speed : null)
    || 1000;
}

/** Vitesse maximale d'un câble pour une longueur donnée (Mb/s). */
export function cableSpeed(cableId = DEFAULT_CABLE, length = DEFAULT_LENGTH) {
  const cable = CABLES[cableId] || CABLES[DEFAULT_CABLE];
  if (cable.shortUntil && length > cable.shortUntil) return cable.long;
  return cable.max;
}

/**
 * Vitesse négociée d'un lien : la plus petite des deux cartes et du câble
 * (auto-négociation). Retourne aussi ce qui limite, pour l'expliquer.
 * @returns {{ speed: number, speedA: number, speedB: number, cableSpeed: number, limitedBy: 'a'|'b'|'cable'|null }}
 */
export function linkSpeed(defA, ifaceA, defB, ifaceB, cableId, length) {
  const a = interfaceSpeed(defA, ifaceA);
  const b = interfaceSpeed(defB, ifaceB);
  const cable = cableSpeed(cableId, length);
  const speed = Math.min(a, b, cable);
  let limitedBy = null;
  if (speed < Math.max(a, b)) limitedBy = cable === speed && cable < Math.min(a, b) ? 'cable' : (a <= b ? 'a' : 'b');
  return { speed, speedA: a, speedB: b, cableSpeed: cable, limitedBy };
}

/**
 * Caractéristiques calculées d'un modèle, comme sur une fiche constructeur :
 *   - capacité de commutation = somme des vitesses des ports × 2 (chaque port émet et reçoit
 *     en même temps : full duplex) ;
 *   - débit de transfert = paquets de 64 octets par seconde quand tous les ports émettent
 *     à pleine vitesse : chaque petite trame occupe 64 + 20 octets sur le câble.
 */
export function specsOf(model) {
  const ports = model.ports.reduce((sum, group) => sum + group.count, 0);
  const total = model.ports.reduce((sum, group) => sum + group.count * group.speed, 0); // Mb/s
  const specs = {
    ports,
    portSummary: model.ports.map((group) => `${group.count} × ${formatSpeed(group.speed)}`).join(' + '),
    switchingCapacity: total * 2,
    forwardingRate: (total * 1e6) / ((MIN_FRAME + WIRE_OVERHEAD) * 8) / 1e6, // millions de paquets/s
    power: model.power,
  };
  if (model.macTable) specs.macTable = model.macTable;
  if (model.routing) specs.routing = model.routing;
  return specs;
}

/** 100 → « 100 Mb/s », 1000 → « 1 Gb/s », 10000 → « 10 Gb/s ». */
export function formatSpeed(mbps) {
  if (mbps >= 1000) {
    const value = mbps / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)} Gb/s`;
  }
  return `${mbps} Mb/s`;
}

/** Débit en bit/s mis en forme : 0 b/s, 850 kb/s, 86,2 Mb/s, 1,2 Gb/s. */
export function formatRate(bps) {
  if (!bps) return '0 b/s';
  const units = [['Gb/s', 1e9], ['Mb/s', 1e6], ['kb/s', 1e3]];
  for (const [unit, size] of units) {
    if (bps >= size) {
      const value = bps / size;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(bps)} b/s`;
}

/** Les modèles d'un type, pour l'éditeur. */
export function modelsOfType(type) {
  return Object.entries(MODELS).filter(([, model]) => model.type === type).map(([id, model]) => ({ id, ...model }));
}
