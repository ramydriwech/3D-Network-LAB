// Débit et bande passante : taille des trames, temps d'émission, mesure du trafic.
//
// ÉCHELLE DE TEMPS. Une trame de 1 500 octets traverse un lien Gigabit en 12 µs : trop vite
// pour être vue. La simulation passe donc au ralenti : 1 µs de réseau réel = 10 ms à l'écran
// (SLOW_MOTION = 10 000). À ce rythme, une grande trame occupe un port Gigabit 0,12 s et un
// port à 100 Mb/s 1,2 s : la différence se voit, et un lien lent devient un goulot visible.
//
// Le temps d'émission (sérialisation) s'ajoute à la traversée du câble (HOP_DURATION, une
// durée d'animation fixe). Entre deux trames qui partent du même port, on laisse au moins
// FRAME_GAP pour que chaque paquet reste visible séparément à l'écran.

/** Ralenti : millisecondes simulées par milliseconde réelle. */
export const SLOW_MOTION = 10000;
/** Écart minimal à l'écran entre deux trames émises par le même port (ms simulées). */
export const FRAME_GAP = 200;
/** Durée de la fenêtre de mesure du débit « en direct » (ms simulées). */
export const RATE_WINDOW = 4000;
/** Taille de segment TCP (MSS) usuelle sur Ethernet. */
export const MSS = 1460;

const ETH_HEADER = 14 + 4; // en-tête Ethernet + FCS
const MIN_FRAME = 64;
const MAX_FRAME = 1518;

const textBytes = (value) => (value == null ? 0 : new TextEncoder().encode(String(value)).length);

/**
 * Taille d'une trame sur le câble, en octets (en-têtes compris, sans préambule).
 * Les tailles des en-têtes sont les vraies ; le contenu applicatif est estimé d'après le
 * paquet simulé (nom DNS, lignes HTTP…), et les données TCP d'après tcp.len.
 */
export function frameBytes(packet) {
  let payload = 0;
  if (packet.arp) payload = 28;
  else if (packet.ipv6) {
    payload = 40 + (packet.icmp6 ? (packet.icmp6.type >= 135 ? 32 : 8 + textBytes(packet.data)) : 0);
  } else if (packet.ip) {
    payload = 20;
    if (packet.tcp) payload += 20 + (packet.tcp.len || 0);
    else if (packet.udp) {
      payload += 8;
      if (packet.dhcp) payload += 300;
      else if (packet.dns) payload += 12 + textBytes(packet.dns.name) + 6 + (packet.dns.answer ? 16 : 0);
      else payload += textBytes(packet.data);
    } else if (packet.icmp) payload += 8 + textBytes(packet.data);
    else payload += textBytes(packet.data);
    if (packet.http && !packet.tcp) payload += textBytes(packet.data);
  } else {
    payload = textBytes(packet.data);
  }
  return Math.min(MAX_FRAME, Math.max(MIN_FRAME, ETH_HEADER + payload));
}

/** Temps d'émission (sérialisation) d'une trame, en ms simulées. */
export function transmitTime(bytes, speedMbps) {
  // bits / (Mb/s × 10^6) secondes réelles → × 1000 ms → × SLOW_MOTION
  return (bytes * 8 * 1000 * SLOW_MOTION) / (speedMbps * 1e6);
}

/** Débit réel (bit/s) correspondant à `bytes` envoyés pendant `simMs` millisecondes simulées. */
export function rateOf(bytes, simMs) {
  if (simMs <= 0) return 0;
  return (bytes * 8) / (simMs / 1000 / SLOW_MOTION);
}

/** Part d'un intervalle [start, end] qui tombe dans [from, to]. */
const overlap = (start, end, from, to) => Math.max(0, Math.min(end, to) - Math.max(start, from));

/**
 * Compteurs de trafic du réseau simulé.
 *
 * Pour chaque port (« equipement:interface ») : octets et trames émis et reçus depuis le
 * début, trames perdues, file d'attente, et les dernières émissions (pour le débit en direct).
 * Pour chaque lien et chaque sens : le temps d'occupation, d'où le taux d'utilisation.
 */
export class TrafficMeter {
  constructor() {
    this.ports = new Map();
    this.links = new Map();
  }

  port(key) {
    if (!this.ports.has(key)) {
      this.ports.set(key, { txBytes: 0, rxBytes: 0, txFrames: 0, rxFrames: 0, lost: 0, queue: 0, maxQueue: 0, recentTx: [], recentRx: [] });
    }
    return this.ports.get(key);
  }

  link(id) {
    if (!this.links.has(id)) this.links.set(id, { busy: { ab: [], ba: [] }, frames: 0, lost: 0 });
    return this.links.get(id);
  }

  /** Une trame attend son tour dans la file du port. */
  queued(portKey) {
    const port = this.port(portKey);
    port.queue += 1;
    port.maxQueue = Math.max(port.maxQueue, port.queue);
  }

  /**
   * Une trame commence son émission : le port est occupé de `start` à `end`. Le lien compte
   * aussi comme occupé pendant l'écart d'affichage qui suit (FRAME_GAP) : sans cela, un lien
   * Gigabit plein à craquer ne paraîtrait chargé qu'à 40 % à l'écran.
   */
  sent(portKey, linkId, direction, bytes, start, end, busyEnd = end) {
    const port = this.port(portKey);
    port.queue = Math.max(0, port.queue - 1);
    port.txBytes += bytes;
    port.txFrames += 1;
    port.recentTx.push([start, end, bytes]);
    const link = this.link(linkId);
    link.frames += 1;
    link.busy[direction].push([start, busyEnd]);
  }

  /** Une trame est arrivée au bout du câble. */
  received(portKey, bytes, time) {
    const port = this.port(portKey);
    port.rxBytes += bytes;
    port.rxFrames += 1;
    port.recentRx.push([time, time, bytes]);
  }

  /** Une trame s'est perdue sur le câble. */
  lostOn(portKey, linkId) {
    this.port(portKey).lost += 1;
    this.link(linkId).lost += 1;
  }

  /** Oublie ce qui est sorti de la fenêtre de mesure (appelé régulièrement). */
  prune(now) {
    const limit = now - RATE_WINDOW * 2;
    for (const port of this.ports.values()) {
      port.recentTx = port.recentTx.filter((entry) => entry[1] >= limit);
      port.recentRx = port.recentRx.filter((entry) => entry[1] >= limit);
    }
    for (const link of this.links.values()) {
      for (const side of ['ab', 'ba']) link.busy[side] = link.busy[side].filter((entry) => entry[1] >= limit);
    }
  }

  /** Débits en direct d'un port (bit/s, réels) sur la fenêtre qui se termine à `now`. */
  portRates(key, now) {
    const port = this.ports.get(key);
    if (!port) return { tx: 0, rx: 0 };
    const from = Math.max(0, now - RATE_WINDOW);
    const span = now - from;
    if (span <= 0) return { tx: 0, rx: 0 };
    const bytesIn = (entries) => entries.reduce((sum, [start, end, bytes]) => {
      if (end <= start) return sum + (start > from && start <= now ? bytes : 0);
      return sum + bytes * (overlap(start, end, from, now) / (end - start));
    }, 0);
    return { tx: rateOf(bytesIn(port.recentTx), span), rx: rateOf(bytesIn(port.recentRx), span) };
  }

  /** Taux d'utilisation (0 à 1) d'un lien sur la fenêtre, dans chaque sens et au pire. */
  linkLoad(id, now) {
    const link = this.links.get(id);
    if (!link) return { ab: 0, ba: 0, max: 0 };
    const from = Math.max(0, now - RATE_WINDOW);
    const span = now - from;
    if (span <= 0) return { ab: 0, ba: 0, max: 0 };
    const busy = (entries) => Math.min(1, entries.reduce((sum, [start, end]) => sum + overlap(start, end, from, now), 0) / span);
    const ab = busy(link.busy.ab);
    const ba = busy(link.busy.ba);
    return { ab, ba, max: Math.max(ab, ba) };
  }
}

/** Seuils d'affichage de la charge d'un lien. */
export const LOAD_LEVELS = Object.freeze({ busy: 0.5, saturated: 0.8 });

/** 'idle' | 'low' | 'busy' | 'saturated' d'après le taux d'utilisation. */
export function loadLevel(load) {
  if (load >= LOAD_LEVELS.saturated) return 'saturated';
  if (load >= LOAD_LEVELS.busy) return 'busy';
  if (load > 0.001) return 'low';
  return 'idle';
}
