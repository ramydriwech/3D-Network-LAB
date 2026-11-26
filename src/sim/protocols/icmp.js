// ICMP — Internet Control Message Protocol : messages de contrôle d'IP.
// La commande « ping » s'en sert pour vérifier qu'une machine est joignable :
// Echo Request (type 8) à l'aller, Echo Reply (type 0) au retour.
//
// Simplifications pédagogiques : pas de somme de contrôle, pas de délai d'expiration du
// ping ; trois messages d'erreur seulement (réseau injoignable, port fermé, TTL expiré).

import { note } from '../events.js';

const ERRORS = {
  net: { type: 3, code: 0, name: 'Destination Unreachable (network)', key: 'icmp.error.net' },
  port: { type: 3, code: 3, name: 'Destination Unreachable (port)', key: 'icmp.error.port' },
  ttl: { type: 11, code: 0, name: 'Time Exceeded', key: 'icmp.error.ttl' },
};

const texts = {
  'icmp.echoRequest': {
    fr: 'Ping n°{seq} : {name} envoie un ICMP Echo Request à {dst} — « es-tu là ? ».',
    en: 'Ping #{seq}: {name} sends an ICMP Echo Request to {dst} — "are you there?".',
  },
  'icmp.echoReply': {
    fr: '{name} répond par un ICMP Echo Reply à {dst}, avec le même identifiant et le même numéro de séquence ({seq}).',
    en: '{name} answers with an ICMP Echo Reply to {dst}, carrying the same identifier and sequence number ({seq}).',
  },
  'icmp.requestReceived': {
    fr: '{name} reçoit l\'Echo Request de {src} : la machine est bien joignable à l\'aller.',
    en: '{name} receives the Echo Request from {src}: the outbound path works.',
  },
  'icmp.success': {
    fr: 'Ping réussi : {name} reçoit la réponse de {src} (séquence {seq}, TTL {ttl}, aller-retour simulé {rtt} ms).',
    en: 'Ping succeeded: {name} receives the reply from {src} (sequence {seq}, TTL {ttl}, simulated round trip {rtt} ms).',
  },
  'icmp.error.net': {
    fr: '{name} prévient {dst} par ICMP « Destination Unreachable » : aucune route vers la destination.',
    en: '{name} tells {dst} with ICMP "Destination Unreachable": no route to the destination.',
  },
  'icmp.error.port': {
    fr: '{name} prévient {dst} par ICMP « Port Unreachable » : aucune application n\'écoute sur ce port.',
    en: '{name} tells {dst} with ICMP "Port Unreachable": no application listens on that port.',
  },
  'icmp.error.ttl': {
    fr: '{name} prévient {dst} par ICMP « Time Exceeded » : le TTL du paquet est arrivé à 0 en chemin.',
    en: '{name} tells {dst} with ICMP "Time Exceeded": the packet\'s TTL reached 0 on the way.',
  },
  'icmp.errorReceived': {
    fr: '{name} reçoit le message d\'erreur ICMP « {what} » envoyé par {src} : l\'envoi a échoué.',
    en: '{name} receives the ICMP error "{what}" sent by {src}: the transmission failed.',
  },
};

/** Adresse IP visée par une étape : `to` est une adresse ou l'identifiant d'un équipement. */
export function targetIp(net, to) {
  const device = net.device(to);
  if (!device) return to;
  const iface = device.interfaces.find((it) => it.ip);
  return iface ? iface.ip : null;
}

function sendEcho(device, session) {
  session.sent += 1;
  const seq = session.sent;
  session.pending.set(seq, device.net.now);
  device.sendIp({
    dst: session.dst,
    proto: 'ICMP',
    ttl: session.ttl,
    protocol: 'icmp',
    label: 'ICMP Echo Request',
    icmp: { type: 8, code: 0, name: 'Echo Request', id: session.id, seq },
    data: 'abcdefgh',
    explain: note('icmp.echoRequest', { name: device.name, dst: session.dst, seq }),
  });
}

function receive(device, net, packet) {
  const { icmp, ip } = packet;
  if (icmp.type === 8) {
    device.sendIp({
      dst: ip.src,
      proto: 'ICMP',
      protocol: 'icmp',
      label: 'ICMP Echo Reply',
      icmp: { type: 0, code: 0, name: 'Echo Reply', id: icmp.id, seq: icmp.seq },
      data: packet.data,
      explain: note('icmp.echoReply', { name: device.name, dst: ip.src, seq: icmp.seq }),
    });
    return { accepted: true, notes: [note('icmp.requestReceived', { name: device.name, src: ip.src })] };
  }
  if (icmp.type === 0) {
    const session = device.ping;
    const sentAt = session ? session.pending.get(icmp.seq) : undefined;
    const rtt = sentAt === undefined ? '?' : Math.round(net.now - sentAt);
    if (session) {
      session.pending.delete(icmp.seq);
      session.received += 1;
      if (session.sent < session.count) sendEcho(device, session);
    }
    return { accepted: true, notes: [note('icmp.success', { name: device.name, src: ip.src, seq: icmp.seq, ttl: ip.ttl, rtt })] };
  }
  return { accepted: true, notes: [note('icmp.errorReceived', { name: device.name, src: ip.src, what: icmp.name })] };
}

export default {
  id: 'icmp',
  name: 'ICMP',
  layer: 'réseau',
  requires: ['arp'],
  actions: ['ping'],
  texts,

  install(device, net) {
    if (!device.sendIp) return;
    device.ping = null;
    device.on('ip:ICMP', (packet) => receive(device, net, packet));
  },

  /** Action de scénario : { action: 'ping', from, to, count?, ttl? }. */
  start(net, step) {
    const device = net.device(step.from);
    const dst = targetIp(net, step.to);
    if (!device || !device.sendIp || !dst) return false;
    device.ping = { id: 1, dst, count: step.count || 1, ttl: step.ttl || 64, sent: 0, received: 0, pending: new Map() };
    sendEcho(device, device.ping);
    return true;
  },

  /**
   * Envoie à la source de `original` un message d'erreur ICMP.
   * Règle métier : on ne répond jamais par une erreur ICMP à une erreur ICMP.
   * @param {'net'|'port'|'ttl'} kind
   */
  error(device, original, kind) {
    const spec = ERRORS[kind];
    if (!spec || !original.ip) return false;
    if (original.icmp && original.icmp.type !== 8 && original.icmp.type !== 0) return false;
    return device.sendIp({
      dst: original.ip.src,
      proto: 'ICMP',
      protocol: 'icmp',
      label: 'ICMP ' + spec.name,
      icmp: { type: spec.type, code: spec.code, name: spec.name, about: original.label },
      explain: note(spec.key, { name: device.name, dst: original.ip.src }),
    });
  },

  describe(packet) {
    if (!packet.icmp) return [];
    const { icmp } = packet;
    const rows = [
      { label: { fr: 'Type', en: 'Type' }, value: `${icmp.type} — ${icmp.name}` },
      { label: { fr: 'Code', en: 'Code' }, value: icmp.code },
    ];
    if (icmp.seq !== undefined) {
      rows.push({ label: { fr: 'Identifiant', en: 'Identifier' }, value: icmp.id });
      rows.push({ label: { fr: 'N° de séquence', en: 'Sequence number' }, value: icmp.seq });
    }
    if (icmp.about) rows.push({ label: { fr: 'Paquet concerné', en: 'About packet' }, value: icmp.about });
    return rows;
  },
};
