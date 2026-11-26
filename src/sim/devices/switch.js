// Comportement d'un switch (commutateur Ethernet).
//
// Le switch ne regarde que les adresses MAC :
//   1. apprentissage — il note sur quel port se trouve l'adresse MAC source de chaque trame ;
//   2. commutation — si la destination est connue, la trame ne sort que par le bon port ;
//   3. inondation — destination inconnue ou diffusion : la trame sort par tous les ports,
//      sauf celui d'arrivée.
//
// Depuis S6 (laboratoire), un switch administrable connaît aussi :
//   - les VLAN : un port d'ACCÈS appartient à un seul VLAN ; un port TRUNK transporte
//     plusieurs VLAN en marquant chaque trame d'une étiquette 802.1Q (sauf le VLAN natif).
//     Une trame ne circule jamais d'un VLAN à un autre : il faut un routeur pour cela ;
//   - la sécurité des ports : seules les adresses MAC autorisées (configurées ou apprises
//     en « sticky ») peuvent émettre ; sinon le port se bloque (err-disabled).
// Réglages dans le scénario : "vlans": { "10": "ADMIN" } et
// "ports": { "p1": { "vlan": 10 }, "u1": { "mode": "trunk", "allowed": [10, 20] },
//            "p3": { "security": { "maximum": 1, "sticky": true } }, "p4": { "shutdown": true } }.
// Simplifications : pas de Spanning Tree, les entrées de la table n'expirent pas.

import { Device } from '../network.js';
import { note } from '../events.js';
import { isGroupMac } from '../addr.js';
import { PortSecurity } from '../security.js';

export const texts = {
  'switch.learn': {
    fr: '{name} apprend que {mac} se trouve derrière son port {port} et l\'inscrit dans sa table MAC.',
    en: '{name} learns that {mac} sits behind its port {port} and writes it into its MAC table.',
  },
  'switch.flood.broadcast': {
    fr: '{name} : la trame est une diffusion ({dst}). Il la recopie sur tous ses ports sauf celui d\'arrivée ({port}).',
    en: '{name}: the frame is a broadcast ({dst}). It copies it to every port except the one it came from ({port}).',
  },
  'switch.flood.unknown': {
    fr: '{name} ne connaît pas encore {dst} : faute de mieux, il envoie la trame sur tous ses ports sauf {port}.',
    en: '{name} does not know {dst} yet: for lack of better, it sends the frame out of every port except {port}.',
  },
  'switch.forward': {
    fr: '{name} trouve {dst} dans sa table MAC : la trame sort uniquement par le port {out}.',
    en: '{name} finds {dst} in its MAC table: the frame leaves through port {out} only.',
  },
  'switch.storm': {
    fr: '{name} : cette trame est déjà passée {count} fois par les switchs du réseau. Elle tourne en rond : il y a une BOUCLE de câbles entre switchs (tempête de diffusion). Le simulateur l\'arrête ici ; un vrai réseau, sans Spanning Tree, serait saturé.',
    en: '{name}: this frame has already crossed the network switches {count} times. It is going round in circles: there is a cable LOOP between switches (broadcast storm). The simulator stops it here; a real network, without Spanning Tree, would be saturated.',
  },
  'switch.vlan.in': {
    fr: '{name} : la trame arrive sur {port} et appartient au VLAN {vlan}.',
    en: '{name}: the frame arrives on {port} and belongs to VLAN {vlan}.',
  },
  'switch.vlan.flood': {
    fr: '{name} recopie la trame uniquement sur les ports du VLAN {vlan} ({ports}) : les autres VLAN ne la voient pas.',
    en: '{name} copies the frame only to the ports of VLAN {vlan} ({ports}): other VLANs never see it.',
  },
  'switch.vlan.tag': {
    fr: '{name} : {out} est un trunk, la trame y sort marquée de l\'étiquette 802.1Q du VLAN {vlan}.',
    en: '{name}: {out} is a trunk, the frame leaves it tagged with the 802.1Q tag of VLAN {vlan}.',
  },
  'switch.vlan.refused': {
    fr: '{name} : la trame du VLAN {vlan} arrive sur {port}, qui n\'accepte pas ce VLAN : elle est détruite.',
    en: '{name}: the VLAN {vlan} frame arrives on {port}, which does not carry that VLAN: it is discarded.',
  },
  'switch.sec.learn': {
    fr: '{name} : sécurité du port {port} — {mac} est la première adresse vue, elle est retenue (« sticky ») comme seule autorisée.',
    en: '{name}: port security on {port} — {mac} is the first address seen, it is kept ("sticky") as the only one allowed.',
  },
  'switch.sec.violation': {
    fr: '{name} : VIOLATION de sécurité sur le port {port} — {mac} n\'est pas autorisée (autorisée : {allowed}). Le port passe en « err-disabled » : il est coupé jusqu\'à ce qu\'un administrateur le réactive.',
    en: '{name}: security VIOLATION on port {port} — {mac} is not allowed (allowed: {allowed}). The port goes "err-disabled": it is shut until an administrator re-enables it.',
  },
  'switch.sec.restrict': {
    fr: '{name} : {mac} n\'est pas autorisée sur le port {port} : la trame est détruite (mode restrict, le port reste actif).',
    en: '{name}: {mac} is not allowed on port {port}: the frame is discarded (restrict mode, the port stays up).',
  },
  'switch.filter': {
    fr: '{name} : {dst} se trouve sur le port d\'arrivée, la trame n\'a pas besoin d\'être relayée.',
    en: '{name}: {dst} lives on the incoming port, the frame does not need forwarding.',
  },
};

export class Switch extends Device {
  constructor(def, net) {
    super(def, net);
    this.macTable = new Map(); // adresse MAC -> nom du port
    this.vlans = { 1: 'default', ...(def.vlans || {}) };
    this.portConfig = def.ports || {};
    this.security = new Map(); // port -> PortSecurity
    for (const [port, config] of Object.entries(this.portConfig)) {
      if (config.security) this.security.set(port, new PortSecurity(config.security));
      if (config.shutdown) this.ensureIface(port).shutdown = true;
    }
  }

  /** Réglage d'un port : { mode: 'access' | 'trunk', vlan, allowed, native }. */
  portMode(port) {
    const config = this.portConfig[port] || {};
    if (config.mode === 'trunk') return { mode: 'trunk', allowed: config.allowed || null, native: config.native || 1 };
    return { mode: 'access', vlan: config.vlan || 1 };
  }

  /** Clé de la table MAC : l'adresse seule dans le VLAN 1, « vlan|adresse » ailleurs. */
  macKey(vlan, mac) {
    return vlan === 1 ? mac : `${vlan}|${mac}`;
  }

  /** Vrai si ce switch utilise plusieurs VLAN (l'affichage montre alors la colonne VLAN). */
  usesVlans() {
    return Object.keys(this.vlans).length > 1 || Object.values(this.portConfig).some((c) => c.mode === 'trunk' || (c.vlan && c.vlan !== 1));
  }

  /** Ce port transporte-t-il ce VLAN ? */
  carries(port, vlan) {
    const mode = this.portMode(port);
    if (mode.mode === 'access') return mode.vlan === vlan;
    return !mode.allowed || mode.allowed.includes(vlan);
  }

  receive(packet, port) {
    const notes = [];
    const { src, dst } = packet.eth;
    // 0. Sécurité du port.
    const security = this.security.get(port);
    if (security) {
      const verdict = security.check(src);
      if (verdict === 'learn') {
        notes.push(note('switch.sec.learn', { name: this.name, port, mac: src }));
        this.net.update(this, 'security');
      } else if (verdict === 'violation') {
        const key = security.violation === 'shutdown' ? 'switch.sec.violation' : 'switch.sec.restrict';
        const why = note(key, { name: this.name, port, mac: src, allowed: security.macs.join(', ') || '—' });
        if (security.errDisabled) this.ensureIface(port).errDisabled = true;
        this.net.drop(this, packet, [why]);
        this.net.update(this, 'security');
        return { accepted: true, notes: [...notes, why] };
      }
    }
    // 1. VLAN de la trame.
    const mode = this.portMode(port);
    let vlan;
    if (mode.mode === 'access') {
      if (packet.vlan && packet.vlan !== mode.vlan) {
        const why = note('switch.vlan.refused', { name: this.name, vlan: packet.vlan, port });
        this.net.drop(this, packet, [why]);
        return { accepted: true, notes: [why] };
      }
      vlan = mode.vlan;
    } else {
      vlan = packet.vlan || mode.native;
      if (!this.carries(port, vlan)) {
        const why = note('switch.vlan.refused', { name: this.name, vlan, port });
        this.net.drop(this, packet, [why]);
        return { accepted: true, notes: [why] };
      }
    }
    const multiVlan = this.usesVlans();
    if (multiVlan) notes.push(note('switch.vlan.in', { name: this.name, port, vlan }));
    // 2. Apprentissage (par VLAN : la même adresse peut exister dans deux VLAN).
    const key = this.macKey(vlan, src);
    if (this.macTable.get(key) !== port) {
      this.macTable.set(key, port);
      this.net.update(this, 'mac');
      notes.push(note('switch.learn', { name: this.name, mac: src, port }));
    }
    packet.switchHops = (packet.switchHops || 0) + 1;
    const limit = 2 * [...this.net.devices.values()].filter((device) => device.type === 'switch').length + 2;
    if (packet.switchHops > limit) {
      const storm = note('switch.storm', { name: this.name, count: packet.switchHops - 1 });
      this.net.drop(this, packet, [storm]);
      return { accepted: true, notes: [...notes, storm] };
    }
    // 3. Sortie : l'étiquette 802.1Q n'existe que sur les trunks (hors VLAN natif).
    const send = (out, decision) => {
      const outMode = this.portMode(out);
      const tag = outMode.mode === 'trunk' && vlan !== outMode.native ? vlan : undefined;
      const frame = tag === packet.vlan ? packet : this.net.clone(packet, { vlan: tag });
      const extra = tag && tag !== packet.vlan ? [note('switch.vlan.tag', { name: this.name, out, vlan })] : [];
      this.net.transmit(this, out, frame, [decision, ...extra]);
    };
    const known = this.macTable.get(this.macKey(vlan, dst));
    if (isGroupMac(dst) || !known) {
      const flood = isGroupMac(dst) ? 'switch.flood.broadcast' : 'switch.flood.unknown';
      const decision = note(flood, { name: this.name, dst, port });
      notes.push(decision);
      const outs = this.interfaces.filter((iface) => iface.name !== port && this.net.peer(this.id, iface.name) && this.carries(iface.name, vlan) && !this.isDown(iface.name));
      if (multiVlan) notes.push(note('switch.vlan.flood', { name: this.name, vlan, ports: outs.map((i) => i.name).join(', ') || '—' }));
      for (const iface of outs) send(iface.name, decision);
    } else if (known === port) {
      notes.push(note('switch.filter', { name: this.name, dst }));
    } else {
      const decision = note('switch.forward', { name: this.name, dst, out: known });
      notes.push(decision);
      send(known, decision);
    }
    return { accepted: true, notes };
  }

  tables() {
    const vlans = this.usesVlans();
    const tables = [{
      id: 'mac',
      title: { fr: 'Table MAC', en: 'MAC table' },
      columns: vlans
        ? [{ fr: 'VLAN', en: 'VLAN' }, { fr: 'Adresse MAC', en: 'MAC address' }, { fr: 'Port', en: 'Port' }]
        : [{ fr: 'Adresse MAC', en: 'MAC address' }, { fr: 'Port', en: 'Port' }],
      rows: [...this.macTable.entries()].map(([key, port]) => {
        if (!vlans) return [key, port];
        return key.includes('|') ? [...key.split('|'), port] : ['1', key, port];
      }),
    }];
    if (this.security.size) {
      tables.push({
        id: 'security',
        title: { fr: 'Sécurité des ports', en: 'Port security' },
        columns: [{ fr: 'Port', en: 'Port' }, { fr: 'Adresses autorisées', en: 'Allowed addresses' }, { fr: 'État', en: 'State' }],
        rows: [...this.security.entries()].map(([port, sec]) => [port, sec.macs.join(', ') || '—', sec.errDisabled ? 'err-disabled' : `OK (${sec.violations} violation(s))`]),
      });
    }
    return tables;
  }
}

export function create(def, net) {
  return new Switch(def, net);
}
