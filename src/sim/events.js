// CONTRAT COMMUN — toute modification passe par une pull request approuvée par les quatre.
//
// Ce fichier fixe le vocabulaire partagé entre la simulation, le rendu 3D et l'interface :
//   1. les sujets (topics) publiés sur le bus d'évènements ;
//   2. la forme d'un paquet simulé ;
//   3. la forme d'une note d'explication ;
//   4. les fonctions que chaque protocole doit fournir (patron Strategy).

/** Sujets publiés sur le bus. La charge utile de chacun est décrite à droite. */
export const Topics = Object.freeze({
  SCENARIO_LOADED: 'scenario:loaded', // { scenario }
  RESET: 'sim:reset',                 // {}
  STATE: 'state:changed',             // { state, previous }
  SPEED: 'speed:changed',             // { speed }
  CLOCK: 'clock:tick',                // { now }                          temps simulé en ms
  STEP: 'step:started',               // { index, step }                  étape du scénario
  PACKET_SEND: 'packet:send',         // { tx, packet, from, to, linkId, time, duration, notes }
  PACKET_RECEIVE: 'packet:receive',   // { tx, packet, device, from, linkId, time, accepted, notes }
  PACKET_DROP: 'packet:drop',         // { packet, device, time, notes }
  DEVICE_UPDATE: 'device:update',     // { device, what, time }           what: 'arp' | 'mac' | 'ip' | 'route' | ...
  NOTE: 'sim:note',                   // { device, time, notes }          explication sans paquet
  FINISHED: 'sim:finished',           // { now }
  SELECT: 'ui:select',                // { kind: 'device' | 'packet' | null, id?, packet? }   publié par l'interface
});

/** Les neuf familles de paquets affichées (une couleur chacune, voir packetStyles.js). */
export const PROTOCOL_IDS = Object.freeze([
  'arp', 'icmp', 'ip', 'udp', 'tcp', 'dns', 'dhcp', 'http', 'ipv6',
]);

/** Durées en millisecondes de temps simulé. */
export const HOP_DURATION = 1000;  // traversée d'un câble
export const PROCESS_DELAY = 200;  // temps de traitement d'un équipement avant d'émettre

/**
 * @typedef {Object} Packet  Trame simulée (simplifiée) qui circule sur un câble.
 * @property {string} id        identifiant unique de la trame
 * @property {string} flow      identifiant du message d'origine (conservé de saut en saut)
 * @property {string} protocol  famille affichée, une valeur de PROTOCOL_IDS
 * @property {string} label     nom court du message, ex. « ARP Request »
 * @property {'unicast'|'broadcast'|'multicast'} cast
 * @property {{src:string,dst:string,type:string}} eth   en-tête Ethernet
 * @property {Object} [arp]   { op, senderMac, senderIp, targetMac, targetIp }
 * @property {Object} [ip]    { src, dst, ttl, proto }
 * @property {Object} [icmp]  { type, code, name, id, seq }
 * @property {Object} [udp]   { srcPort, dstPort }
 * @property {Object} [tcp]   { srcPort, dstPort, flags, seq, ack, len }
 * @property {Object} [dns] @property {Object} [dhcp] @property {Object} [http] @property {Object} [ipv6]
 * @property {string} [data]  contenu simplifié
 * @property {Note} [explain] explication du message, posée par le protocole émetteur
 */

/**
 * @typedef {Object} Note  Explication affichée à l'utilisateur.
 * @property {string} key      clé de texte, ex. « arp.request » (voir `texts` des protocoles)
 * @property {Object} [params] valeurs injectées dans le texte, ex. { ip: '192.168.1.1' }
 */

/** Crée une note d'explication. */
export function note(key, params = {}) {
  return { key, params };
}

/** Type de diffusion déduit de l'adresse MAC de destination. */
export function castOf(dstMac) {
  const mac = String(dstMac || '').toUpperCase();
  if (mac === 'FF:FF:FF:FF:FF:FF') return 'broadcast';
  if ((parseInt(mac.slice(0, 2), 16) & 1) === 1) return 'multicast';
  return 'unicast';
}

/**
 * Crée un paquet conforme au contrat. `id` est fourni par le réseau simulé pour rester
 * déterministe (voir Network.packet()).
 * @returns {Packet}
 */
export function createPacket(fields, id) {
  const packet = { flow: id, ...fields, id };
  if (!packet.flow) packet.flow = id;
  if (packet.eth) packet.cast = castOf(packet.eth.dst);
  const errors = validatePacket(packet);
  if (errors.length) throw new Error('Paquet invalide : ' + errors.join(' ; '));
  return packet;
}

/** Vérifie la forme d'un paquet ; retourne la liste des erreurs (vide si tout va bien). */
export function validatePacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== 'object') return ['le paquet doit être un objet'];
  if (!packet.id) errors.push('id manquant');
  if (!PROTOCOL_IDS.includes(packet.protocol)) errors.push(`protocole inconnu « ${packet.protocol} »`);
  if (!packet.label) errors.push('label manquant');
  if (!packet.eth || !packet.eth.src || !packet.eth.dst || !packet.eth.type) {
    errors.push('en-tête eth incomplet (src, dst, type)');
  }
  if (packet.ip && (!packet.ip.src || !packet.ip.dst || typeof packet.ip.ttl !== 'number')) {
    errors.push('en-tête ip incomplet (src, dst, ttl)');
  }
  return errors;
}

/**
 * CONTRAT D'UN PROTOCOLE (patron Strategy).
 * Chaque fichier src/sim/protocols/<id>.js exporte par défaut un objet de cette forme :
 *
 *   id        {string}    identifiant, égal au nom du fichier (ex. 'arp')
 *   name      {string}    nom affiché (ex. 'ARP')
 *   layer     {string}    'liaison' | 'réseau' | 'transport' | 'application'
 *   requires  {string[]}  protocoles dont il dépend (chargés automatiquement)
 *   actions   {string[]}  actions de scénario qu'il sait lancer (ex. ['ping'])
 *   texts     {Object}    textes d'explication : { 'arp.request': { fr: '…', en: '…' } }
 *   install(device, net)  appelé pour chaque équipement à la construction du réseau ;
 *                         le protocole y branche ses réceptions : device.on('eth:ARP', fn)
 *   start(net, step)      lance une action du scénario (obligatoire si `actions` n'est pas vide)
 *   describe(packet)      lignes pour l'inspecteur : [{ label: {fr, en}, value }]
 *   table(device)         (facultatif) tableau d'état à afficher dans le panneau d'infos :
 *                         { id, title: {fr, en}, columns: [{fr, en}], rows: [[…]] } ou null
 */
export const PROTOCOL_CONTRACT = Object.freeze({
  required: ['id', 'name', 'layer', 'texts', 'install', 'describe'],
  layers: ['liaison', 'réseau', 'transport', 'application'],
});

/** Vérifie qu'un protocole respecte le contrat ; retourne la liste des erreurs. */
export function validateProtocol(protocol) {
  const errors = [];
  if (!protocol || typeof protocol !== 'object') return ['le protocole doit être un objet'];
  for (const key of PROTOCOL_CONTRACT.required) {
    if (protocol[key] === undefined) errors.push(`« ${key} » manquant`);
  }
  if (protocol.layer && !PROTOCOL_CONTRACT.layers.includes(protocol.layer)) {
    errors.push(`couche inconnue « ${protocol.layer} »`);
  }
  for (const fn of ['install', 'describe']) {
    if (protocol[fn] !== undefined && typeof protocol[fn] !== 'function') errors.push(`« ${fn} » doit être une fonction`);
  }
  if (protocol.actions && protocol.actions.length && typeof protocol.start !== 'function') {
    errors.push('« start » est obligatoire quand « actions » est renseigné');
  }
  for (const [key, text] of Object.entries(protocol.texts || {})) {
    if (!text || typeof text.fr !== 'string' || typeof text.en !== 'string') {
      errors.push(`texte « ${key} » : il faut une version fr et une version en`);
    }
  }
  return errors;
}

/** Remplace les {param} d'un texte par leurs valeurs. */
export function formatText(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (all, name) => (params[name] !== undefined ? params[name] : all));
}
