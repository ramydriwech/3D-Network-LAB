// TCP — Transmission Control Protocol : transport fiable, « avec connexion ».
//
// Trois phases simulées :
//   1. ouverture en trois temps : SYN → SYN,ACK → ACK ;
//   2. données : chaque segment (PSH,ACK) est acquitté par un ACK dont le numéro annonce
//      le prochain octet attendu ;
//   3. fermeture en quatre temps : FIN,ACK → ACK → FIN,ACK → ACK.
//
// Simplifications pédagogiques :
//   - numéros de séquence initiaux fixes (1000 côté client, 5000 côté serveur) pour que
//     les calculs soient faciles à suivre ; un vrai système les tire au hasard ;
//   - un petit message part en un seul segment. Un TRANSFERT (« size » dans le scénario) est
//     découpé en segments de MSS octets envoyés par fenêtre glissante (« window » segments
//     sans attendre d'accusé), avec acquittement cumulatif, mise en attente des segments
//     arrivés dans le désordre, ACK dupliqués, retransmission rapide au 3e ACK dupliqué et
//     retransmission sur délai (RTO). Les segments listés dans « lose » se perdent une fois.
//     Pas de contrôle de congestion : la fenêtre reste fixe, pour que l'effet soit lisible ;
//   - l'application du client n'émet ses données qu'une fois l'ouverture terminée des deux
//     côtés, et le serveur n'envoie son FIN qu'après l'arrivée de son ACK : ainsi chaque
//     segment est visible séparément.

import { note } from '../events.js';
import { targetIp } from './icmp.js';
import { MSS, rateOf } from '../traffic.js';
import { formatRate } from '../catalog.js';

export const CLIENT_ISN = 1000;
export const SERVER_ISN = 5000;
const FIRST_EPHEMERAL_PORT = 49152;
/** Fenêtre d'émission par défaut d'un transfert, en segments. */
export const DEFAULT_WINDOW = 4;
/** Nombre d'ACK dupliqués qui déclenche la retransmission rapide. */
export const DUP_ACK_THRESHOLD = 3;

export const TcpState = Object.freeze({
  SYN_SENT: 'SYN_SENT',
  SYN_RECEIVED: 'SYN_RECEIVED',
  ESTABLISHED: 'ESTABLISHED',
  FIN_WAIT_1: 'FIN_WAIT_1',
  FIN_WAIT_2: 'FIN_WAIT_2',
  CLOSE_WAIT: 'CLOSE_WAIT',
  LAST_ACK: 'LAST_ACK',
  CLOSED: 'CLOSED',
});

const texts = {
  'tcp.syn': {
    fr: 'Ouverture 1/3 — {name} demande une connexion au port {port} de {dst} : segment SYN, numéro de séquence initial {seq}.',
    en: 'Handshake 1/3 — {name} asks for a connection to port {port} of {dst}: SYN segment, initial sequence number {seq}.',
  },
  'tcp.synack': {
    fr: 'Ouverture 2/3 — {name} accepte : SYN,ACK. Il annonce son propre numéro de séquence ({seq}) et acquitte celui du client (ACK = {ack}, soit {isn} + 1).',
    en: 'Handshake 2/3 — {name} accepts: SYN,ACK. It announces its own sequence number ({seq}) and acknowledges the client\'s (ACK = {ack}, i.e. {isn} + 1).',
  },
  'tcp.ack3': {
    fr: 'Ouverture 3/3 — {name} acquitte le SYN du serveur (ACK = {ack}). Les deux côtés connaissent maintenant le numéro de séquence de l\'autre.',
    en: 'Handshake 3/3 — {name} acknowledges the server\'s SYN (ACK = {ack}). Both sides now know each other\'s sequence number.',
  },
  'tcp.established': {
    fr: '{name} : la connexion TCP est établie. Les données peuvent circuler dans les deux sens.',
    en: '{name}: the TCP connection is established. Data can flow both ways.',
  },
  'tcp.data': {
    fr: '{name} envoie {len} octets de données (PSH,ACK), numérotés à partir de {seq}.',
    en: '{name} sends {len} bytes of data (PSH,ACK), numbered from {seq}.',
  },
  'tcp.dataAck': {
    fr: '{name} a bien reçu les {len} octets : il répond ACK = {ack} (« j\'attends maintenant l\'octet {ack} »). C\'est ce qui rend TCP fiable.',
    en: '{name} received the {len} bytes: it answers ACK = {ack} ("I now expect byte {ack}"). This is what makes TCP reliable.',
  },
  'tcp.acked': {
    fr: '{name} reçoit l\'accusé de réception : toutes ses données sont arrivées.',
    en: '{name} receives the acknowledgement: all its data arrived.',
  },
  'tcp.fin1': {
    fr: 'Fermeture 1/4 — {name} n\'a plus rien à envoyer : segment FIN,ACK.',
    en: 'Teardown 1/4 — {name} has nothing more to send: FIN,ACK segment.',
  },
  'tcp.finAck': {
    fr: 'Fermeture 2/4 — {name} acquitte le FIN (ACK = {ack}). La connexion est à moitié fermée.',
    en: 'Teardown 2/4 — {name} acknowledges the FIN (ACK = {ack}). The connection is half closed.',
  },
  'tcp.fin2': {
    fr: 'Fermeture 3/4 — {name} ferme à son tour son sens de transmission : FIN,ACK.',
    en: 'Teardown 3/4 — {name} closes its own direction in turn: FIN,ACK.',
  },
  'tcp.lastAck': {
    fr: 'Fermeture 4/4 — {name} acquitte le dernier FIN (ACK = {ack}).',
    en: 'Teardown 4/4 — {name} acknowledges the last FIN (ACK = {ack}).',
  },
  'tcp.closed': {
    fr: '{name} : la connexion TCP est fermée, ses ressources sont libérées.',
    en: '{name}: the TCP connection is closed and its resources are released.',
  },
  'tcp.rst': {
    fr: '{name} : aucune application n\'écoute sur le port {port}. Il refuse la connexion par un segment RST.',
    en: '{name}: no application listens on port {port}. It refuses the connection with an RST segment.',
  },
  'tcp.refused': {
    fr: '{name} reçoit un RST : connexion refusée par {src}.',
    en: '{name} receives an RST: connection refused by {src}.',
  },
  'tcp.bulkStart': {
    fr: '{name} commence à envoyer {size} octets : {count} segments de {mss} octets au plus. Fenêtre : {window} segments peuvent partir sans attendre d\'accusé.',
    en: '{name} starts sending {size} bytes: {count} segments of at most {mss} bytes. Window: {window} segments may leave without waiting for an acknowledgement.',
  },
  'tcp.bulkSeg': {
    fr: '{name} envoie le segment {index}/{count} : octets {seq} à {last} ({len} octets).',
    en: '{name} sends segment {index}/{count}: bytes {seq} to {last} ({len} bytes).',
  },
  'tcp.bulkAck': {
    fr: '{name} a reçu sans trou jusqu\'à l\'octet {last} : ACK = {ack}. Un seul ACK acquitte tout ce qui précède (acquittement cumulatif).',
    en: '{name} received everything up to byte {last}: ACK = {ack}. One ACK acknowledges everything before it (cumulative acknowledgement).',
  },
  'tcp.outOfOrder': {
    fr: '{name} reçoit les octets {seq}… alors qu\'il attend l\'octet {ack} : il en manque. Il garde ce segment de côté et répète ACK = {ack} (ACK dupliqué).',
    en: '{name} receives bytes {seq}… while it expects byte {ack}: something is missing. It keeps this segment aside and repeats ACK = {ack} (duplicate ACK).',
  },
  'tcp.filled': {
    fr: '{name} reçoit le segment manquant : avec ceux mis de côté, tout est complet jusqu\'à l\'octet {last}. ACK = {ack}.',
    en: '{name} receives the missing segment: with those kept aside, everything is complete up to byte {last}. ACK = {ack}.',
  },
  'tcp.dupAck': {
    fr: '{name} reçoit un ACK dupliqué ({count}/{threshold}) : l\'octet {ack} n\'est toujours pas arrivé.',
    en: '{name} receives a duplicate ACK ({count}/{threshold}): byte {ack} still has not arrived.',
  },
  'tcp.fastRetransmit': {
    fr: 'Retransmission rapide — {name} a reçu {threshold} ACK dupliqués : le segment {index} est sûrement perdu. Il le renvoie sans attendre la fin du délai.',
    en: 'Fast retransmit — {name} received {threshold} duplicate ACKs: segment {index} is surely lost. It resends it without waiting for the timeout.',
  },
  'tcp.timeout': {
    fr: 'Délai dépassé (RTO) — {name} n\'a reçu aucun accusé pour le segment {index} : il le renvoie.',
    en: 'Timeout (RTO) — {name} received no acknowledgement for segment {index}: it resends it.',
  },
  'tcp.bulkDone': {
    fr: '{name} : les {size} octets sont arrivés et acquittés en {time} s (à l\'échelle réelle : {real}), soit un débit utile de {rate}. Retransmissions : {retransmits}.',
    en: '{name}: the {size} bytes arrived and were acknowledged in {time} s (at real scale: {real}), a useful throughput of {rate}. Retransmissions: {retransmits}.',
  },
};

const keyOf = (localIp, localPort, remoteIp, remotePort) => `${localIp}:${localPort}>${remoteIp}:${remotePort}`;

/** Connexion vue par l'équipement à l'autre bout (le simulateur voit les deux côtés). */
function peerOf(conn) {
  const direct = conn.device.net.tcpConns.get(keyOf(conn.remoteIp, conn.remotePort, conn.localIp, conn.localPort));
  if (direct) return direct;
  // À travers un NAT, les deux extrémités ne voient pas les mêmes adresses : on retrouve
  // l'autre bout grâce à l'identifiant interne de connexion porté par le SYN.
  return (conn.peerUid && conn.device.net.tcpByUid && conn.device.net.tcpByUid.get(conn.peerUid)) || null;
}

function register(conn) {
  conn.device.net.tcpConns.set(keyOf(conn.localIp, conn.localPort, conn.remoteIp, conn.remotePort), conn);
  conn.device.tcpConns.set(`${conn.localPort}>${conn.remoteIp}:${conn.remotePort}`, conn);
}

function setState(conn, state) {
  conn.state = state;
  conn.device.net.update(conn.device, 'tcp');
}

/** Émet un segment sur la connexion. */
function segment(conn, flags, { data = '', explain, extra = {} } = {}) {
  const len = String(data).length;
  const packet = {
    dst: conn.remoteIp,
    proto: 'TCP',
    protocol: 'tcp',
    label: 'TCP ' + flags.join(','),
    explain,
    ...extra,
    tcp: { srcPort: conn.localPort, dstPort: conn.remotePort, flags, seq: conn.snd, ack: flags.includes('ACK') ? conn.rcv : 0, len },
  };
  if (conn.uid) packet.tcp.conn = conn.uid; // repère interne du simulateur (pas un vrai champ TCP)
  if (len) packet.data = data;
  // SYN et FIN comptent chacun pour un octet dans la numérotation.
  conn.snd += len + (flags.includes('SYN') ? 1 : 0) + (flags.includes('FIN') ? 1 : 0);
  return conn.device.sendIp(packet);
}

function closed(conn) {
  setState(conn, TcpState.CLOSED);
  conn.device.net.info(conn.device, [note('tcp.closed', { name: conn.device.name })]);
  if (conn.app.onClose) conn.app.onClose(conn);
}

function sendFin(conn, key) {
  setState(conn, key === 'tcp.fin1' ? TcpState.FIN_WAIT_1 : TcpState.LAST_ACK);
  segment(conn, ['FIN', 'ACK'], { explain: note(key, { name: conn.device.name }) });
}

function receive(device, net, packet) {
  const { tcp: seg, ip } = packet;
  const flags = new Set(seg.flags);
  let conn = device.tcpConns.get(`${seg.dstPort}>${ip.src}:${seg.srcPort}`);

  // --- Demande d'ouverture sur un port en écoute
  if (!conn && flags.has('SYN') && !flags.has('ACK')) {
    const app = device.tcpListeners.get(seg.dstPort);
    if (!app) {
      const reset = { device, localIp: ip.dst, localPort: seg.dstPort, remoteIp: ip.src, remotePort: seg.srcPort, snd: 0, rcv: seg.seq + 1 };
      segment(reset, ['RST', 'ACK'], { explain: note('tcp.rst', { name: device.name, port: seg.dstPort }) });
      return { accepted: true, notes: [note('tcp.rst', { name: device.name, port: seg.dstPort })] };
    }
    conn = {
      device, app, isClient: false, state: TcpState.SYN_RECEIVED,
      localIp: ip.dst, localPort: seg.dstPort, remoteIp: ip.src, remotePort: seg.srcPort,
      snd: SERVER_ISN, rcv: seg.seq + 1,
    };
    conn.peerUid = seg.conn || null;
    register(conn);
    net.update(device, 'tcp');
    segment(conn, ['SYN', 'ACK'], {
      explain: note('tcp.synack', { name: device.name, seq: SERVER_ISN, ack: conn.rcv, isn: seg.seq }),
    });
    return { accepted: true, notes: [] };
  }
  if (!conn) return { accepted: false, notes: [] };

  // --- Refus de connexion
  if (flags.has('RST')) {
    setState(conn, TcpState.CLOSED);
    if (conn.app.onClose) conn.app.onClose(conn, { refused: true });
    return { accepted: true, notes: [note('tcp.refused', { name: device.name, src: ip.src })] };
  }

  // --- Ouverture, côté client : réception du SYN,ACK
  if (conn.state === TcpState.SYN_SENT && flags.has('SYN') && flags.has('ACK')) {
    conn.rcv = seg.seq + 1;
    conn.rtt = net.now - conn.openedAt; // aller-retour mesuré pendant l'ouverture
    setState(conn, TcpState.ESTABLISHED);
    segment(conn, ['ACK'], { explain: note('tcp.ack3', { name: device.name, ack: conn.rcv }) });
    return { accepted: true, notes: [] };
  }

  // --- Ouverture, côté serveur : réception du troisième segment
  if (conn.state === TcpState.SYN_RECEIVED && flags.has('ACK')) {
    setState(conn, TcpState.ESTABLISHED);
    if (conn.app.onOpen) conn.app.onOpen(conn);
    const client = peerOf(conn);
    if (client && client.app.onOpen) client.app.onOpen(client);
    return { accepted: true, notes: [note('tcp.established', { name: device.name })] };
  }

  // --- Fermeture : réception d'un FIN
  if (flags.has('FIN')) {
    conn.rcv = seg.seq + seg.len + 1;
    if (conn.state === TcpState.ESTABLISHED) { // fermeture demandée par l'autre côté
      setState(conn, TcpState.CLOSE_WAIT);
      segment(conn, ['ACK'], { explain: note('tcp.finAck', { name: device.name, ack: conn.rcv }) });
      return { accepted: true, notes: [] };
    }
    // FIN_WAIT_2 : c'est le FIN de l'autre côté, on envoie le dernier ACK
    segment(conn, ['ACK'], { explain: note('tcp.lastAck', { name: device.name, ack: conn.rcv }) });
    closed(conn);
    return { accepted: true, notes: [] };
  }

  // --- Transfert découpé en segments
  if (seg.len > 0 && packet.bulk) return bulkReceive(conn, seg);
  if (flags.has('ACK') && conn.bulk && !conn.bulk.done && conn.state === TcpState.ESTABLISHED) return bulkAck(conn, seg);
  // --- Données
  if (seg.len > 0) {
    conn.rcv = seg.seq + seg.len;
    const answer = (conn.app.onData && conn.app.onData(conn, packet.data, packet)) || {};
    if (answer.reply) {
      // La réponse de l'application transporte aussi l'accusé de réception.
      tcpApi.send(conn, answer.reply.data, answer.reply);
    } else if (answer.close) {
      sendFin(conn, 'tcp.fin1'); // le FIN,ACK acquitte les données au passage
    } else {
      segment(conn, ['ACK'], { explain: note('tcp.dataAck', { name: device.name, len: seg.len, ack: conn.rcv }) });
    }
    return { accepted: true, notes: [] };
  }

  // --- ACK seul
  if (flags.has('ACK')) {
    if (conn.state === TcpState.FIN_WAIT_1) {
      setState(conn, TcpState.FIN_WAIT_2);
      const other = peerOf(conn);
      if (other && other.state === TcpState.CLOSE_WAIT) sendFin(other, 'tcp.fin2');
      return { accepted: true, notes: [] };
    }
    if (conn.state === TcpState.LAST_ACK) {
      closed(conn);
      return { accepted: true, notes: [] };
    }
    if (conn.state === TcpState.ESTABLISHED && seg.ack === conn.snd && conn.waitingAck) {
      conn.waitingAck = false;
      if (conn.app.onAcked) conn.app.onAcked(conn);
      return { accepted: true, notes: [note('tcp.acked', { name: device.name })] };
    }
  }
  return { accepted: true, notes: [] };
}

/** Délai de retransmission : quatre allers-retours mesurés, avec un minimum. */
const rtoOf = (conn) => Math.max(8000, 4 * (conn.rtt || 4000));

/** Émet le segment de transfert qui commence à `seq` (premier envoi ou retransmission). */
function bulkSegment(conn, seq, explain) {
  const bulk = conn.bulk;
  const len = Math.min(MSS, bulk.end - seq);
  const index = Math.floor((seq - bulk.start) / MSS);
  const packet = {
    dst: conn.remoteIp, proto: 'TCP', protocol: 'tcp', bulk: true,
    label: `TCP ${index + 1}/${bulk.count}`,
    explain: explain || note('tcp.bulkSeg', { name: conn.device.name, index: index + 1, count: bulk.count, seq, last: seq + len - 1, len }),
    tcp: { srcPort: conn.localPort, dstPort: conn.remotePort, flags: ['PSH', 'ACK'], seq, ack: conn.rcv, len },
  };
  if (bulk.lose.has(index) && !bulk.lostOnce.has(index)) { // perte simulée, une seule fois
    bulk.lostOnce.add(index);
    packet.lost = true;
  }
  conn.device.sendIp(packet);
  return len;
}

function armTimer(conn) {
  const bulk = conn.bulk;
  const net = conn.device.net;
  if (bulk.timer != null) net.cancel(bulk.timer);
  bulk.timer = net.after(rtoOf(conn), () => {
    bulk.timer = null;
    if (bulk.done || conn.state !== TcpState.ESTABLISHED) return;
    bulk.retransmits += 1;
    bulk.dupAcks = 0;
    const index = Math.floor((bulk.base - bulk.start) / MSS) + 1;
    bulkSegment(conn, bulk.base, note('tcp.timeout', { name: conn.device.name, index }));
    armTimer(conn);
  });
}

/** Envoie tout ce que la fenêtre autorise. */
function fillWindow(conn) {
  const bulk = conn.bulk;
  while (bulk.next < bulk.end && bulk.next < bulk.base + bulk.window * MSS) {
    bulk.next += bulkSegment(conn, bulk.next);
  }
  conn.snd = bulk.next;
  if (bulk.timer == null) armTimer(conn);
}

/** Côté émetteur : un accusé de réception arrive pendant le transfert. */
function bulkAck(conn, seg) {
  const bulk = conn.bulk;
  const net = conn.device.net;
  if (seg.ack > bulk.base) { // l'accusé fait avancer la fenêtre
    bulk.base = seg.ack;
    bulk.dupAcks = 0;
    if (bulk.base >= bulk.end) {
      bulk.done = true;
      if (bulk.timer != null) net.cancel(bulk.timer);
      bulk.timer = null;
      const elapsed = net.now - bulk.startedAt;
      const seconds = (elapsed / 1000).toFixed(1);
      const realMs = elapsed / 10000; // ralenti, voir traffic.js
      bulk.rate = rateOf(bulk.size, elapsed);
      net.info(conn.device, [note('tcp.bulkDone', {
        name: conn.device.name, size: bulk.size, time: seconds,
        real: realMs >= 1 ? `${realMs.toFixed(2)} ms` : `${(realMs * 1000).toFixed(0)} µs`,
        rate: formatRate(bulk.rate), retransmits: bulk.retransmits,
      })]);
      net.update(conn.device, 'tcp');
      if (conn.app.onAcked) conn.app.onAcked(conn);
      return { accepted: true, notes: [] };
    }
    armTimer(conn);
    fillWindow(conn);
    return { accepted: true, notes: [] };
  }
  if (seg.ack === bulk.base && bulk.base < bulk.next) { // ACK dupliqué
    bulk.dupAcks += 1;
    const notes = [note('tcp.dupAck', { name: conn.device.name, count: bulk.dupAcks, threshold: DUP_ACK_THRESHOLD, ack: seg.ack })];
    if (bulk.dupAcks === DUP_ACK_THRESHOLD) {
      bulk.retransmits += 1;
      const index = Math.floor((bulk.base - bulk.start) / MSS) + 1;
      bulkSegment(conn, bulk.base, note('tcp.fastRetransmit', { name: conn.device.name, threshold: DUP_ACK_THRESHOLD, index }));
      armTimer(conn);
    }
    return { accepted: true, notes };
  }
  return { accepted: true, notes: [] };
}

/** Côté récepteur : un segment de transfert arrive. */
function bulkReceive(conn, seg) {
  if (!conn.buffered) conn.buffered = new Map(); // seq -> len, segments arrivés trop tôt
  if (conn.rcvStart == null) conn.rcvStart = conn.rcv;
  const name = conn.device.name;
  let key = 'tcp.bulkAck';
  if (seg.seq === conn.rcv) {
    conn.rcv += seg.len;
    if (conn.buffered.size) {
      while (conn.buffered.has(conn.rcv)) {
        const len = conn.buffered.get(conn.rcv);
        conn.buffered.delete(conn.rcv);
        conn.rcv += len;
        key = 'tcp.filled';
      }
    }
  } else if (seg.seq > conn.rcv) {
    conn.buffered.set(seg.seq, seg.len);
    key = 'tcp.outOfOrder';
  }
  segment(conn, ['ACK'], { explain: note(key, { name, seq: seg.seq, ack: conn.rcv, last: conn.rcv - 1 }) });
  conn.device.net.update(conn.device, 'tcp');
  return { accepted: true, notes: [] };
}

const tcpApi = {
  id: 'tcp',
  name: 'TCP',
  layer: 'transport',
  requires: ['arp', 'icmp'],
  actions: ['tcp'],
  texts,

  install(device, net) {
    if (!device.sendIp) return;
    if (!net.tcpConns) net.tcpConns = new Map(); // toutes les connexions du réseau simulé
    device.tcpListeners = new Map(); // port -> application
    device.tcpConns = new Map();
    device.tcpNextPort = FIRST_EPHEMERAL_PORT;
    device.on('ip:TCP', (packet) => receive(device, net, packet));
    const service = device.def.services && device.def.services.tcp;
    for (const port of (service && service.listen) || []) tcpApi.listen(device, port, {});
  },

  /**
   * Met une application en écoute sur un port.
   * `app` : { onOpen(conn), onData(conn, data, packet), onClose(conn) } ; onData peut
   * retourner { reply: { data, … } } pour répondre, ou { close: true } pour fermer.
   */
  listen(device, port, app = {}) {
    device.tcpListeners.set(port, app);
  },

  /** Ouvre une connexion vers `dst`:`port`. Retourne la connexion (état SYN_SENT). */
  connect(device, { dst, port }, app = {}) {
    const hop = device.lookup(dst);
    const conn = {
      device, app, isClient: true, state: TcpState.SYN_SENT,
      localIp: hop ? hop.iface.ip : device.primary().ip, localPort: device.tcpNextPort++,
      remoteIp: dst, remotePort: port,
      snd: CLIENT_ISN, rcv: 0,
      openedAt: device.net.now,
    };
    conn.uid = `${device.id}:${conn.localPort}:${++device.net.tcpUidSeq || (device.net.tcpUidSeq = 1)}`;
    if (!device.net.tcpByUid) device.net.tcpByUid = new Map();
    device.net.tcpByUid.set(conn.uid, conn);
    register(conn);
    device.net.update(device, 'tcp');
    segment(conn, ['SYN'], { explain: note('tcp.syn', { name: device.name, dst, port, seq: CLIENT_ISN }) });
    return conn;
  },

  /** Envoie des données. `extra` permet à un protocole applicatif d'ajouter ses champs. */
  send(conn, data, extra = {}) {
    const { data: ignored, explain, ...fields } = extra;
    conn.waitingAck = true;
    return segment(conn, ['PSH', 'ACK'], {
      data,
      explain: explain || note('tcp.data', { name: conn.device.name, len: String(data).length, seq: conn.snd }),
      extra: fields,
    });
  },

  /**
   * Envoie `size` octets découpés en segments (fenêtre glissante, voir l'en-tête du fichier).
   * `lose` : numéros (à partir de 0) des segments qui se perdent à leur premier envoi.
   */
  transfer(conn, size, { window = DEFAULT_WINDOW, lose = [] } = {}) {
    const count = Math.ceil(size / MSS);
    conn.bulk = {
      start: conn.snd, end: conn.snd + size, size, count, window: window || DEFAULT_WINDOW,
      base: conn.snd, next: conn.snd, dupAcks: 0, lose: new Set(lose), lostOnce: new Set(),
      timer: null, startedAt: conn.device.net.now, retransmits: 0, done: false,
    };
    conn.device.net.info(conn.device, [note('tcp.bulkStart', { name: conn.device.name, size, count, mss: MSS, window: conn.bulk.window })]);
    fillWindow(conn);
    return conn.bulk;
  },

  /** Ferme la connexion (fermeture active). */
  close(conn) {
    if (conn.state !== TcpState.ESTABLISHED) return false;
    sendFin(conn, 'tcp.fin1');
    return true;
  },

  /** Action de scénario : { action: 'tcp', from, to, port, data? }. */
  start(net, step) {
    const device = net.device(step.from);
    const dst = targetIp(net, step.to);
    if (!device || !device.sendIp || !dst) return false;
    if (step.size) {
      tcpApi.connect(device, { dst, port: step.port }, {
        onOpen: (conn) => conn.isClient && tcpApi.transfer(conn, step.size, { window: step.window, lose: step.lose }),
        onAcked: (conn) => tcpApi.close(conn),
      });
      return true;
    }
    tcpApi.connect(device, { dst, port: step.port }, {
      onOpen: (conn) => tcpApi.send(conn, step.data || 'Bonjour'),
      onAcked: (conn) => tcpApi.close(conn),
    });
    return true;
  },

  describe(packet) {
    if (!packet.tcp) return [];
    const seg = packet.tcp;
    return [
      { label: { fr: 'Port source', en: 'Source port' }, value: seg.srcPort },
      { label: { fr: 'Port destination', en: 'Destination port' }, value: seg.dstPort },
      { label: { fr: 'Indicateurs', en: 'Flags' }, value: seg.flags.join(', ') },
      { label: { fr: 'N° de séquence', en: 'Sequence number' }, value: seg.seq },
      { label: { fr: 'N° d\'acquittement', en: 'Acknowledgement number' }, value: seg.flags.includes('ACK') ? seg.ack : '—' },
      { label: { fr: 'Données', en: 'Data' }, value: { fr: `${seg.len} octets`, en: `${seg.len} bytes` } },
    ];
  },

  /** Lignes du tableau des connexions affiché dans le panneau d'infos. */
  table(device) {
    // Colonne « Transfert » : progression d'un envoi découpé, ou octets reçus.
    const progress = (conn) => {
      if (conn.bulk) {
        const acked = conn.bulk.base - conn.bulk.start;
        return conn.bulk.done ? `${conn.bulk.size} o ✓ ${formatRate(conn.bulk.rate)}` : `${acked}/${conn.bulk.size} o`;
      }
      return conn.rcvStart != null ? `${conn.rcv - conn.rcvStart} o ↓` : '—';
    };
    return {
      id: 'tcp',
      title: { fr: 'Connexions TCP', en: 'TCP connections' },
      columns: [{ fr: 'Local', en: 'Local' }, { fr: 'Distant', en: 'Remote' }, { fr: 'État', en: 'State' }, { fr: 'Transfert', en: 'Transfer' }],
      rows: [...(device.tcpConns || new Map()).values()].map((conn) => [`:${conn.localPort}`, `${conn.remoteIp}:${conn.remotePort}`, conn.state, progress(conn)]),
    };
  },
};

export default tcpApi;
