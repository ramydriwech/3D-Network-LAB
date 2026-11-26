// Fiche technique et trafic d'un équipement (demande du superviseur).
//
// Deux parties, ajoutées au panneau d'infos :
//   - la fiche du modèle : description et caractéristiques CALCULÉES à partir des ports
//     (capacité de commutation, débit de transfert…), avec la façon de les obtenir ;
//   - les ports en direct : vitesse négociée de chaque lien (et ce qui la bride), débits
//     émis et reçus, file d'attente et trames perdues. Ce tableau se met à jour tout seul
//     pendant la lecture, sans reconstruire le reste du panneau.

import { CABLES, formatRate, formatSpeed, modelIdOf, modelOf, specsOf } from '../sim/catalog.js';
import { el } from './dom.js';
import { localize, registerStrings, t } from './i18n.js';

registerStrings({
  fr: {
    'sheet.title': 'Fiche technique',
    'sheet.model': 'Modèle',
    'sheet.ports': 'Ports',
    'sheet.switching': 'Capacité de commutation',
    'sheet.switching.how': 'somme des vitesses des ports × 2 (émission et réception simultanées)',
    'sheet.forwarding': 'Débit de transfert',
    'sheet.forwarding.how': 'petites trames de 64 octets (+ 20 octets de préambule et d\'intervalle) à pleine vitesse sur tous les ports',
    'sheet.mac': 'Table MAC', 'sheet.mac.unit': '{n} adresses',
    'sheet.routing': 'Routes statiques', 'sheet.routing.unit': '{n} au plus',
    'sheet.power': 'Consommation', 'sheet.power.unit': '{n} W',
    'sheet.traffic': 'Ports en direct',
    'sheet.port': 'Port', 'sheet.speed': 'Vitesse', 'sheet.peer': 'Relié à', 'sheet.tx': 'Émis', 'sheet.rx': 'Reçu', 'sheet.queue': 'File / perdues',
    'sheet.unplugged': 'non branché',
    'sheet.limit.cable': 'bridé par le câble {cable}',
    'sheet.limit.self': 'bridé par cette carte',
    'sheet.limit.peer': 'bridé par {peer}',
    'sheet.legend': 'Débits à l\'échelle réelle, mesurés sur les 4 dernières secondes de simulation.',
  },
  en: {
    'sheet.title': 'Datasheet',
    'sheet.model': 'Model',
    'sheet.ports': 'Ports',
    'sheet.switching': 'Switching capacity',
    'sheet.switching.how': 'sum of port speeds × 2 (sending and receiving at the same time)',
    'sheet.forwarding': 'Forwarding rate',
    'sheet.forwarding.how': 'small 64-byte frames (+ 20 bytes of preamble and gap) at full speed on every port',
    'sheet.mac': 'MAC table', 'sheet.mac.unit': '{n} addresses',
    'sheet.routing': 'Static routes', 'sheet.routing.unit': 'up to {n}',
    'sheet.power': 'Power draw', 'sheet.power.unit': '{n} W',
    'sheet.traffic': 'Live ports',
    'sheet.port': 'Port', 'sheet.speed': 'Speed', 'sheet.peer': 'Connected to', 'sheet.tx': 'Sent', 'sheet.rx': 'Received', 'sheet.queue': 'Queue / lost',
    'sheet.unplugged': 'not plugged in',
    'sheet.limit.cable': 'limited by the {cable} cable',
    'sheet.limit.self': 'limited by this card',
    'sheet.limit.peer': 'limited by {peer}',
    'sheet.legend': 'Real-scale rates, measured over the last 4 seconds of simulation.',
  },
});

/** 16384 → « 16 384 » (lisible en français comme en anglais). */
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** Mise à jour du tableau des ports pendant la lecture (ms réelles). */
const REFRESH = 400;

/** Ce qui bride un lien, vu depuis l'équipement `deviceId`. */
function limitText(link, deviceId, peerName) {
  if (!link || link.limitedBy === null) return '';
  if (link.limitedBy === 'cable') return t('sheet.limit.cable', { cable: (CABLES[link.cable] || {}).name || link.cable });
  const mine = link.limitedBy === 'a' ? link.a.device === deviceId : link.b.device === deviceId;
  return mine ? t('sheet.limit.self') : t('sheet.limit.peer', { peer: peerName });
}

/** Lignes du tableau des ports, avec les débits du moment. */
export function portRows(sim, device) {
  const traffic = sim.traffic();
  return device.interfaces.map((iface) => {
    const link = sim.network.linkAt(device.id, iface.name);
    if (!link) return { port: iface.name, speed: '—', note: t('sheet.unplugged'), peer: '—', tx: '—', rx: '—', queue: '—', level: 'idle' };
    const peerEnd = link.a.device === device.id && link.a.iface === iface.name ? link.b : link.a;
    const peer = sim.device(peerEnd.device);
    const peerName = peer ? peer.name : peerEnd.device;
    const meter = traffic && traffic.ports[`${device.id}:${iface.name}`];
    const load = traffic && traffic.links[link.id] ? traffic.links[link.id].max : 0;
    return {
      port: iface.name,
      speed: formatSpeed(link.speed),
      note: limitText(link, device.id, peerName),
      peer: `${peerName} (${peerEnd.iface})`,
      tx: meter ? formatRate(meter.tx) : '0 b/s',
      rx: meter ? formatRate(meter.rx) : '0 b/s',
      queue: meter ? `${meter.queue} / ${meter.lost}` : '0 / 0',
      load,
    };
  });
}

/** Fiche du modèle : liste de [libellé, valeur, explication éventuelle]. */
export function sheetFacts(def) {
  const model = modelOf(def);
  if (!model) return [];
  const specs = specsOf(model);
  const facts = [
    [t('sheet.model'), `${model.name} (${modelIdOf(def)})`],
    [t('sheet.ports'), specs.portSummary],
  ];
  if (def.type === 'switch' || def.type === 'router') {
    facts.push([t('sheet.switching'), formatSpeed(specs.switchingCapacity), t('sheet.switching.how')]);
    facts.push([t('sheet.forwarding'), `${specs.forwardingRate.toFixed(1)} Mpps`, t('sheet.forwarding.how')]);
  }
  if (specs.macTable) facts.push([t('sheet.mac'), t('sheet.mac.unit', { n: thousands(specs.macTable) })]);
  if (specs.routing) facts.push([t('sheet.routing'), t('sheet.routing.unit', { n: thousands(specs.routing) })]);
  facts.push([t('sheet.power'), t('sheet.power.unit', { n: specs.power })]);
  return facts;
}

function portTable(sim, device) {
  const body = el('tbody');
  const fill = () => {
    body.replaceChildren(...portRows(sim, device).map((row) => el('tr', { class: row.load >= 0.8 ? 'load-high' : row.load >= 0.5 ? 'load-mid' : null },
      el('td', {}, row.port),
      el('td', {}, row.speed, row.note ? el('div', { class: 'limit' }, row.note) : null),
      el('td', {}, row.peer),
      el('td', {}, row.tx),
      el('td', {}, row.rx),
      el('td', {}, row.queue))));
  };
  fill();
  const table = el('table', { class: 'data ports-live' },
    el('thead', {}, el('tr', {}, ['sheet.port', 'sheet.speed', 'sheet.peer', 'sheet.tx', 'sheet.rx', 'sheet.queue'].map((key) => el('th', {}, t(key))))),
    body);
  // Mise à jour en direct tant que le tableau est affiché.
  const timer = setInterval(() => {
    if (!table.isConnected) { clearInterval(timer); return; }
    if (sim.state === 'playing') fill();
  }, REFRESH);
  return table;
}

/** Éléments à ajouter au panneau d'infos pour l'équipement `device`. */
export function datasheetSection(sim, device) {
  if (!sim.traffic || !sim.network) return [];
  const facts = sheetFacts(device.def || {});
  const model = modelOf(device.def || {});
  const parts = [el('h3', { class: 'sub-title' }, t('sheet.title'))];
  if (model) parts.push(el('p', { class: 'small' }, localize(model.description)));
  if (facts.length) {
    parts.push(el('dl', { class: 'sheet' }, facts.flatMap(([label, value, how]) => [
      el('dt', {}, label),
      el('dd', {}, value, how ? el('div', { class: 'muted small' }, how) : null),
    ])));
  }
  parts.push(el('h3', { class: 'sub-title' }, t('sheet.traffic')));
  parts.push(portTable(sim, device));
  parts.push(el('p', { class: 'muted small' }, t('sheet.legend')));
  return parts;
}
