// DNS — Domain Name System : traduire un nom (www.supcom.tn) en adresse IP.
// Le client envoie une question à son serveur DNS dans un datagramme UDP (port 53) ;
// le serveur répond avec l'adresse, ou avec une erreur si le nom n'existe pas.
//
// Simplifications pédagogiques : un seul serveur qui connaît toutes les réponses (pas de
// résolution récursive entre serveurs), enregistrements de type A uniquement, les entrées
// du cache n'expirent pas.

import { note } from '../events.js';
import udp from './udp.js';

export const DNS_PORT = 53;

const texts = {
  'dns.query': {
    fr: '{name} ne connaît pas l\'adresse de « {host} ». Il pose la question à son serveur DNS {server} (UDP, port 53) : « Quelle est l\'adresse IP de {host} ? »',
    en: '{name} does not know the address of "{host}". It asks its DNS server {server} (UDP, port 53): "What is the IP address of {host}?"',
  },
  'dns.response': {
    fr: '{name} trouve « {host} » dans ses enregistrements et répond : {host} = {ip}.',
    en: '{name} finds "{host}" in its records and answers: {host} = {ip}.',
  },
  'dns.nxdomain': {
    fr: '{name} ne connaît pas « {host} » : il répond par l\'erreur NXDOMAIN (nom inexistant).',
    en: '{name} does not know "{host}": it answers with the NXDOMAIN error (no such name).',
  },
  'dns.resolved': {
    fr: '{name} reçoit la réponse : {host} = {ip}. Il la garde dans son cache DNS pour ne pas reposer la question.',
    en: '{name} receives the answer: {host} = {ip}. It keeps it in its DNS cache so it need not ask again.',
  },
  'dns.failed': {
    fr: '{name} : le nom « {host} » n\'existe pas, la résolution a échoué.',
    en: '{name}: the name "{host}" does not exist, resolution failed.',
  },
  'dns.cacheHit': {
    fr: '{name} connaît déjà {host} = {ip} grâce à son cache DNS : aucune question n\'est envoyée.',
    en: '{name} already knows {host} = {ip} from its DNS cache: no query is sent.',
  },
  'dns.noServer': {
    fr: '{name} n\'a aucun serveur DNS configuré : impossible de résoudre « {host} ».',
    en: '{name} has no DNS server configured: cannot resolve "{host}".',
  },
};

/** Côté serveur : répond aux questions à partir de la table « records » du scénario. */
function serve(device, records, packet) {
  const host = packet.dns.name;
  const ip = records[host] || null;
  udp.send(device, {
    dst: packet.ip.src,
    srcPort: DNS_PORT,
    dstPort: packet.udp.srcPort,
    protocol: 'dns',
    label: ip ? 'DNS Response' : 'DNS Response (NXDOMAIN)',
    dns: { id: packet.dns.id, qr: 'response', name: host, type: 'A', rcode: ip ? 'NOERROR' : 'NXDOMAIN', answer: ip },
    explain: note(ip ? 'dns.response' : 'dns.nxdomain', { name: device.name, host, ip }),
  });
  return { accepted: true, notes: [] };
}

const dns = {
  id: 'dns',
  name: 'DNS',
  layer: 'application',
  requires: ['udp'],
  actions: ['dns'],
  texts,

  install(device) {
    if (!device.sendIp) return;
    device.dnsCache = new Map(); // nom -> adresse IP
    device.dnsNextId = 1;
    const service = device.def.services && device.def.services.dns;
    if (service) udp.bind(device, DNS_PORT, (packet) => serve(device, service.records || {}, packet));
  },

  /**
   * Résout `host` pour le compte de `device`. `done(ip, notes)` reçoit l'adresse, ou null
   * si le nom n'existe pas.
   */
  resolve(device, host, done) {
    const net = device.net;
    const cached = device.dnsCache.get(host);
    if (cached) {
      const hit = note('dns.cacheHit', { name: device.name, host, ip: cached });
      net.info(device, [hit]);
      done(cached, [hit]);
      return true;
    }
    if (!device.dnsServer) {
      net.info(device, [note('dns.noServer', { name: device.name, host })]);
      done(null, []);
      return false;
    }
    const port = udp.ephemeralPort(device);
    const id = device.dnsNextId++;
    udp.bind(device, port, (packet) => {
      if (!packet.dns || packet.dns.id !== id) return undefined;
      udp.unbind(device, port);
      const ip = packet.dns.answer;
      if (ip) device.dnsCache.set(host, ip);
      const result = note(ip ? 'dns.resolved' : 'dns.failed', { name: device.name, host, ip });
      done(ip, [result]);
      return { accepted: true, notes: [result] };
    });
    return udp.send(device, {
      dst: device.dnsServer,
      srcPort: port,
      dstPort: DNS_PORT,
      protocol: 'dns',
      label: 'DNS Query',
      dns: { id, qr: 'query', name: host, type: 'A' },
      explain: note('dns.query', { name: device.name, host, server: device.dnsServer }),
    });
  },

  /** Action de scénario : { action: 'dns', from, name }. */
  start(net, step) {
    const device = net.device(step.from);
    if (!device || !device.sendIp) return false;
    return dns.resolve(device, step.name, () => {});
  },

  describe(packet) {
    if (!packet.dns) return [];
    const rows = [
      { label: { fr: 'Identifiant', en: 'Transaction ID' }, value: packet.dns.id },
      { label: { fr: 'Message', en: 'Message' }, value: packet.dns.qr === 'query' ? { fr: 'question', en: 'query' } : { fr: 'réponse', en: 'response' } },
      { label: { fr: 'Nom demandé', en: 'Queried name' }, value: `${packet.dns.name} (type ${packet.dns.type})` },
    ];
    if (packet.dns.qr === 'response') {
      rows.push({ label: { fr: 'Code de réponse', en: 'Response code' }, value: packet.dns.rcode });
      rows.push({ label: { fr: 'Adresse', en: 'Address' }, value: packet.dns.answer || '—' });
    }
    return rows;
  },
};

export default dns;
