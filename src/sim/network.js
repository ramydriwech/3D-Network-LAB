// Réseau simulé : les équipements, les câbles et la circulation des trames.
// Ce module ne connaît aucun protocole : il transporte des paquets d'un bout à l'autre
// d'un câble et les remet à l'équipement d'arrivée.

import { Topics, createPacket, note, HOP_DURATION, PROCESS_DELAY } from './events.js';
import { parseEndpoint } from './scenario.js';
import { DEFAULT_CABLE, DEFAULT_LENGTH, linkSpeed } from './catalog.js';
import { FRAME_GAP, TrafficMeter, frameBytes, transmitTime } from './traffic.js';

/** Textes des explications produites par le réseau lui-même. */
export const CORE_TEXTS = {
  'trace.hop': {
    fr: 'Paquet de test : {from} l\'envoie à {to} sur le câble qui les relie.',
    en: 'Test packet: {from} sends it to {to} over the cable between them.',
  },
  'trace.arrived': {
    fr: 'Le paquet de test est arrivé à {name}.',
    en: 'The test packet has reached {name}.',
  },
  'net.unplugged': {
    fr: '{name} : l\'interface {iface} n\'est reliée à aucun câble, le paquet est perdu.',
    en: '{name}: interface {iface} has no cable attached, the packet is lost.',
  },
  'sim.unknownAction': {
    fr: 'Action « {action} » inconnue : aucun protocole chargé ne sait la lancer.',
    en: 'Unknown action "{action}": no loaded protocol can start it.',
  },
  'net.ifaceDown': {
    fr: 'L\'interface {iface} de {name} est éteinte (shutdown) ou bloquée : rien ne passe.',
    en: 'Interface {iface} of {name} is shut down or blocked: nothing goes through.',
  },
  'net.lost': {
    fr: 'La trame « {label} » se perd sur le câble entre {from} et {to} (perturbation simulée) : elle n\'arrivera jamais.',
    en: 'The frame "{label}" is lost on the cable between {from} and {to} (simulated interference): it will never arrive.',
  },
  'net.group': {
    fr: 'Plusieurs échanges démarrent en même temps : ils se partagent les liens du réseau.',
    en: 'Several exchanges start at the same time: they share the network links.',
  },
};

/** Équipement de base : il a des interfaces mais ne réagit à rien. */
export class Device {
  constructor(def, net) {
    this.def = def;
    this.net = net;
    this.id = def.id;
    this.type = def.type;
    this.name = def.name;
    // Réglages avancés d'une interface (laboratoire, S6) : sous-interface d'un VLAN
    // (« g0/0.10 » avec vlan 10), interface éteinte (shutdown), liste d'accès, rôle NAT,
    // zone et niveau de sécurité d'un pare-feu.
    this.interfaces = (def.interfaces || []).map((iface) => ({
      name: iface.name,
      mac: iface.mac ? iface.mac.toUpperCase() : null,
      ip: iface.ip || null,
      prefix: iface.prefix || null,
      parent: iface.name.includes('.') ? iface.name.split('.')[0] : null,
      vlan: iface.vlan || null,
      shutdown: iface.shutdown === true,
      errDisabled: false,
      acl: iface.acl || null,
      nat: iface.nat || null,
      zone: iface.zone || null,
      level: iface.level != null ? iface.level : null,
      description: iface.description || null,
    }));
    for (const iface of this.interfaces) {
      if (iface.parent && !iface.mac) iface.mac = (this.iface(iface.parent) || {}).mac || null;
    }
  }

  /** Vrai si l'interface (ou son interface physique) est éteinte ou bloquée. */
  isDown(name) {
    const iface = this.iface(name);
    if (!iface) return false;
    if (iface.shutdown || iface.errDisabled) return true;
    return iface.parent ? this.isDown(iface.parent) : false;
  }

  iface(name) {
    return this.interfaces.find((iface) => iface.name === name) || null;
  }

  /** Les ports d'un switch peuvent n'être déclarés que par les câbles. */
  ensureIface(name) {
    if (!this.iface(name)) this.interfaces.push({ name, mac: null, ip: null, prefix: null });
    return this.iface(name);
  }

  /**
   * Réception d'une trame sur une interface.
   * @returns {{accepted: boolean, notes: Array}|undefined}
   */
  receive() {
    return { accepted: true, notes: [] };
  }

  /** Tables internes à afficher dans le panneau d'infos (cache ARP, table MAC…). */
  tables() {
    return [];
  }
}

export class Network {
  /**
   * @param {Object} options
   * @param {Object} options.scenario     scénario validé
   * @param {Object} options.engine       moteur (schedule, cancel, now)
   * @param {Object} options.bus          bus d'évènements
   * @param {Object} options.registry     registre des protocoles
   * @param {Object} [options.deviceTypes] fabriques par type : { host: create, … } (patron Factory)
   */
  constructor({ scenario, engine, bus, registry, deviceTypes = {} }) {
    this.scenario = scenario;
    this.engine = engine;
    this.bus = bus;
    this.registry = registry;
    this.devices = new Map();
    this.links = new Map();
    this.wires = new Map(); // « equipement:interface » -> { linkId, device, iface }
    this.packetSeq = 0;
    this.txSeq = 0;
    this.busyUntil = new Map(); // « equipement:interface » -> date de fin d'émission
    this.traffic = new TrafficMeter();

    for (const def of scenario.devices) {
      const create = deviceTypes[def.type];
      this.devices.set(def.id, create ? create(def, this) : new Device(def, this));
    }
    for (const link of scenario.links || []) {
      const a = parseEndpoint(link.a);
      const b = parseEndpoint(link.b);
      this.devices.get(a.device).ensureIface(a.iface);
      this.devices.get(b.device).ensureIface(b.iface);
      // Vitesse négociée : la plus petite des deux cartes et du câble (auto-négociation).
      const defA = this.devices.get(a.device).def;
      const defB = this.devices.get(b.device).def;
      const cable = link.cable || DEFAULT_CABLE;
      const length = link.length || DEFAULT_LENGTH;
      const negotiated = linkSpeed(defA, a.iface, defB, b.iface, cable, length);
      this.links.set(link.id, { id: link.id, a, b, aKey: link.a, bKey: link.b, cable, length, ...negotiated });
      this.wires.set(link.a, { linkId: link.id, device: this.devices.get(b.device), iface: b.iface });
      this.wires.set(link.b, { linkId: link.id, device: this.devices.get(a.device), iface: a.iface });
    }
    for (const protocol of registry ? registry.all() : []) {
      for (const device of this.devices.values()) protocol.install(device, this);
    }
  }

  get now() { return this.engine.now; }

  device(id) { return this.devices.get(id) || null; }

  /** Ce qui se trouve à l'autre bout du câble branché sur `ifaceName`, ou null. */
  peer(deviceId, ifaceName) {
    return this.wires.get(`${deviceId}:${ifaceName}`) || null;
  }

  /** Nom de l'interface de `from` directement câblée vers `to`, ou null. */
  ifaceToward(from, to) {
    for (const iface of from.interfaces) {
      const wire = this.peer(from.id, iface.name);
      if (wire && wire.device === to) return iface.name;
    }
    return null;
  }

  /** Crée un paquet avec un identifiant déterministe. */
  packet(fields) {
    return createPacket(fields, 'p' + (++this.packetSeq));
  }

  /** Copie d'un paquet pour un nouveau saut (nouvel id, même flux), en-têtes modifiables. */
  clone(packet, overrides = {}) {
    const copy = { ...packet, eth: { ...packet.eth }, ...overrides };
    if (packet.ip) copy.ip = { ...packet.ip, ...(overrides.ip || {}) };
    return createPacket({ ...copy, flow: packet.flow }, 'p' + (++this.packetSeq));
  }

  /**
   * Émet `packet` sur l'interface `ifaceName` de `device`.
   * Deux évènements sont programmés : le départ (après le temps de traitement) puis
   * l'arrivée (après la traversée du câble). L'arrivée est une « frontière » de pas à pas.
   * @param {Array} notes  explications propres à ce saut (ex. décision du switch)
   * @param {Object} [options] delay : temps de traitement ; onDelivered : remplace device.receive()
   */
  transmit(device, ifaceName, packet, notes = [], { delay = PROCESS_DELAY, onDelivered = null } = {}) {
    // Sous-interface « g0/0.10 » : la trame sort par l'interface physique g0/0, marquée
    // de l'étiquette 802.1Q du VLAN 10.
    const sub = device.iface ? device.iface(ifaceName) : null;
    if (sub && sub.parent) {
      packet = this.clone(packet, { vlan: sub.vlan });
      ifaceName = sub.parent;
    }
    if (device.isDown && device.isDown(ifaceName)) {
      this.drop(device, packet, [note('net.ifaceDown', { name: device.name, iface: ifaceName })]);
      return false;
    }
    const wire = this.peer(device.id, ifaceName);
    if (!wire) {
      this.drop(device, packet, [note('net.unplugged', { name: device.name, iface: ifaceName })]);
      return false;
    }
    const tx = 't' + (++this.txSeq); // identifiant de ce trajet (un même paquet peut être recopié sur plusieurs câbles)
    // Règle métier : une interface n'émet qu'une trame à la fois. Si une trame est déjà en
    // route sur ce câble dans ce sens, la suivante attend qu'elle soit arrivée.
    const port = `${device.id}:${ifaceName}`;
    // Le port émet les trames les unes après les autres (file d'attente). Une trame occupe
    // le port pendant son temps d'émission, qui dépend de sa taille et de la vitesse du lien ;
    // elle arrive après ce temps plus la traversée du câble.
    const link = this.links.get(wire.linkId);
    const bytes = frameBytes(packet);
    const sending = Math.max(1, Math.round(transmitTime(bytes, link.speed))); // ms entières : traces lisibles
    const departure = Math.max(this.now + delay, this.busyUntil.get(port) || 0);
    this.busyUntil.set(port, departure + sending + FRAME_GAP);
    const duration = HOP_DURATION + sending;
    const direction = link.aKey === port ? 'ab' : 'ba';
    const lost = packet.lost === true;
    this.traffic.queued(port);
    this.engine.schedule(departure - this.now, () => {
      this.traffic.sent(port, wire.linkId, direction, bytes, this.now, this.now + sending, this.now + sending + FRAME_GAP);
      this.bus.emit(Topics.PACKET_SEND, {
        tx,
        packet,
        from: device.id,
        to: wire.device.id,
        linkId: wire.linkId,
        time: this.now,
        duration,
        bytes,
        sending,
        lost,
        notes: [packet.explain, ...notes].filter(Boolean),
      });
      if (lost) {
        // La trame disparaît à mi-chemin : personne ne la recevra.
        this.engine.schedule(Math.round(duration / 2), () => {
          this.traffic.lostOn(port, wire.linkId);
          this.drop(device, packet, [note('net.lost', { label: packet.label, from: device.name, to: wire.device.name })],
            { tx, linkId: wire.linkId, onLink: true });
        }, { boundary: true });
        return;
      }
      this.engine.schedule(duration, () => {
        this.traffic.received(`${wire.device.id}:${wire.iface}`, bytes, this.now);
        // Une interface éteinte ne reçoit rien.
        if (wire.device.isDown && wire.device.isDown(wire.iface)) {
          this.drop(wire.device, packet, [note('net.ifaceDown', { name: wire.device.name, iface: wire.iface })], { tx, linkId: wire.linkId, onLink: true });
          return;
        }
        const result = onDelivered
          ? onDelivered(wire.device, wire.iface)
          : wire.device.receive(packet, wire.iface);
        this.bus.emit(Topics.PACKET_RECEIVE, {
          tx,
          packet,
          device: wire.device.id,
          from: device.id,
          linkId: wire.linkId,
          time: this.now,
          accepted: !result || result.accepted !== false,
          notes: (result && result.notes) || [],
        });
      }, { boundary: true });
    });
    return true;
  }

  /** Signale un paquet abandonné, avec la raison. */
  drop(device, packet, notes = [], extra = {}) {
    this.bus.emit(Topics.PACKET_DROP, { packet, device: device.id, time: this.now, notes, ...extra });
  }

  /** Publie une explication qui n'est liée à aucun paquet en transit. */
  info(device, notes = []) {
    this.bus.emit(Topics.NOTE, { device: device ? device.id : null, time: this.now, notes });
  }

  /** Signale qu'une table ou une adresse d'un équipement a changé. */
  update(device, what) {
    this.bus.emit(Topics.DEVICE_UPDATE, { device: device.id, what, time: this.now });
  }

  /** Minuterie en temps simulé ; retourne un identifiant pour cancel(). */
  after(delay, run) { return this.engine.schedule(delay, run); }
  cancel(id) { return this.engine.cancel(id); }

  /** Lien branché sur une interface, avec sa vitesse négociée, ou null. */
  linkAt(deviceId, ifaceName) {
    const wire = this.peer(deviceId, ifaceName);
    return wire ? this.links.get(wire.linkId) : null;
  }

  /**
   * État du trafic à l'instant présent : charge de chaque lien (0 à 1, au pire des deux sens)
   * et débits de chaque port, en bit/s réels.
   */
  trafficSnapshot() {
    const now = this.now;
    this.traffic.prune(now);
    const links = {};
    for (const link of this.links.values()) {
      const load = this.traffic.linkLoad(link.id, now);
      const meter = this.traffic.links.get(link.id);
      links[link.id] = { ...load, speed: link.speed, frames: meter ? meter.frames : 0, lost: meter ? meter.lost : 0 };
    }
    const ports = {};
    for (const [key, port] of this.traffic.ports) {
      ports[key] = { ...this.traffic.portRates(key, now), txBytes: port.txBytes, rxBytes: port.rxBytes,
        txFrames: port.txFrames, rxFrames: port.rxFrames, lost: port.lost, queue: port.queue, maxQueue: port.maxQueue };
    }
    return { now, links, ports };
  }

  /** Lance une action de scénario. */
  runAction(step) {
    if (step.action === 'trace') return this._trace(step);
    if (step.action === 'group') { // plusieurs échanges simultanés
      this.info(null, [note('net.group')]);
      return (step.steps || []).map((inner) => this.runAction(inner)).some(Boolean);
    }
    const owner = this.registry && this.registry.actionOwner(step.action);
    if (owner) return owner.start(this, step);
    this.info(null, [note('sim.unknownAction', { action: step.action })]);
    return false;
  }

  /**
   * Action intégrée « trace » : un paquet de test suit le chemin donné, saut par saut,
   * sans faire intervenir la logique des équipements. Sert à vérifier l'animation.
   */
  _trace(step) {
    const path = (step.path || []).map((id) => this.devices.get(id));
    if (path.length < 2) return false;
    const first = path[0];
    const last = path[path.length - 1];
    const macOf = (device) => (device.interfaces[0] && device.interfaces[0].mac) || '00:00:00:00:00:00';
    const ipOf = (device) => (device.interfaces[0] && device.interfaces[0].ip) || '0.0.0.0';
    const packet = this.packet({
      protocol: step.protocol || 'ip',
      label: step.label || 'Test',
      eth: { src: macOf(first), dst: macOf(last), type: 'IPv4' },
      ip: { src: ipOf(first), dst: ipOf(last), ttl: 64, proto: 'TEST' },
      data: step.data || 'paquet de test',
    });
    const hop = (index) => {
      if (index >= path.length - 1) {
        this.info(last, [note('trace.arrived', { name: last.name })]);
        return;
      }
      const from = path[index];
      const to = path[index + 1];
      this.transmit(from, this.ifaceToward(from, to), packet,
        [note('trace.hop', { from: from.name, to: to.name })],
        { onDelivered: () => { hop(index + 1); return { accepted: true, notes: [] }; } });
    };
    hop(0);
    return true;
  }
}

/** Fichier qui code le comportement de chaque type d'équipement. */
const DEVICE_MODULES = { host: 'host', server: 'host', router: 'router', switch: 'switch', firewall: 'firewall' };

/**
 * Charge les fabriques des types d'équipement présents dans un scénario (patron Factory).
 * Un type dont le fichier n'existe pas encore reste un équipement passif.
 */
export async function loadDeviceTypes(types, registry) {
  const factories = {};
  for (const type of new Set(types)) {
    const file = DEVICE_MODULES[type];
    if (!file) continue;
    try {
      const module = await import(new URL(`./devices/${file}.js`, import.meta.url).href);
      factories[type] = module.create;
      if (registry && module.texts) registry.addTexts(module.texts);
    } catch (error) {
      console.warn(`[sim] comportement « ${type} » indisponible (devices/${file}.js) : équipement passif.`, error.message);
    }
  }
  return factories;
}
