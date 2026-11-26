// Console des équipements (laboratoire de Steve, S7).
//
// Steve branche son câble console (ou ouvre l'invite de commandes d'un PC) et tape des
// commandes, comme sur du vrai matériel. Trois styles existent, selon le système du modèle
// (catalog.js → SYSTEMS) :
//   - « ios » : enable, configure terminal, interface …, show … (routeurs, switchs, pare-feu) ;
//   - « vrp » : system-view, interface …, display …, undo … ;
//   - « pc »  : ipconfig, ping, tracert, arp -a, nslookup, netsh … (PC et serveurs).
//
// Fonctionnement :
//   - les commandes de CONFIGURATION ne modifient pas directement l'équipement en marche :
//     elles produisent un nouveau scénario (fonctions de config.js et builder.js), que
//     l'interface recharge. La scène, le diagnostic et la fiche technique suivent ;
//   - les commandes d'AFFICHAGE (show / display) lisent l'état vivant de la simulation
//     (tables ARP, MAC, NAT, sessions…) ;
//   - ping et traceroute demandent à l'interface de jouer des étapes, puis la console
//     affiche le résultat (!!!!! ou .....) quand la simulation a fini.
//
// Raccourcis comme sur les vraies consoles : « conf t », « sh ip int br », « int g0/1 » ;
// « ? » liste les possibilités, Tab complète le mot en cours, « do » exécute une commande
// d'affichage depuis le mode configuration (style ios).
//
// Le texte affiché par l'équipement est en anglais, comme sur le vrai matériel ; les
// messages d'erreur de configuration suivent la langue de l'interface.

import { inNetwork, isIp } from './addr.js';
import { MODELS, modelOf, portNames, systemOf, specsOf, formatSpeed } from './catalog.js';
import * as B from './builder.js';
import * as C from './config.js';
import { parseMatch } from './security.js';
import { validateScenario } from './scenario.js';

// ----------------------------------------------------------------- noms d'interfaces

const TYPES = {
  ios: { p: 'GigabitEthernet0/', u: 'TenGigabitEthernet1/', eth: 'Ethernet', 'g0/': 'GigabitEthernet0/', 'g0/0/': 'GigabitEthernet0/0/' },
  vrp: { p: 'GigabitEthernet0/0/', u: 'XGigabitEthernet0/0/', eth: 'Ethernet', 'g0/': 'GigabitEthernet0/', 'g0/0/': 'GigabitEthernet0/0/' },
  pc: { eth: 'Ethernet' },
};
const SHORT = {
  ios: { GigabitEthernet: 'Gi', TenGigabitEthernet: 'Te', Ethernet: 'Eth' },
  vrp: { XGigabitEthernet: 'XGE', GigabitEthernet: 'GE', Ethernet: 'Eth' },
};

/** Aide des mots intermédiaires (« show ? » → liste de ce qui peut suivre). */
const KEYWORDS = {
  show: 'Show running system information', display: 'Display information', ip: 'IP information / configuration',
  interface: 'Select an interface', interfaces: 'Interface status and configuration', no: 'Negate a command or set its defaults',
  undo: 'Undo a command or set to its default status', switchport: 'Set switching mode characteristics', port: 'Port configuration',
  'port-security': 'Port security', access: 'Access mode characteristics', trunk: 'Trunking characteristics', mode: 'Set the interface mode',
  vlan: 'VLAN commands', nat: 'NAT configuration', route: 'Static routes', 'route-static': 'Static routes', 'access-list': 'Access lists',
  'access-group': 'Apply an access list', mac: 'MAC configuration', 'mac-address': 'MAC addresses', clear: 'Reset functions',
  configure: 'Enter configuration mode', copy: 'Copy from one file to another', write: 'Write running configuration to memory',
  acl: 'Access control list', rule: 'ACL rule', 'traffic-filter': 'Packet filtering', lldp: 'LLDP neighbors', cdp: 'CDP neighbors',
  firewall: 'Firewall information', session: 'Sessions', running: 'Running configuration', 'running-config': 'Current operating configuration',
};

/** Ports physiques d'un équipement (noms internes : p1, u1, g0/0, eth0…). */
export function physicalPorts(def) {
  if (def.type === 'switch') {
    const fromModel = portNames(modelOf(def));
    const cabled = Object.keys(def.ports || {});
    return [...new Set([...fromModel, ...cabled])];
  }
  return (def.interfaces || []).filter((iface) => !iface.name.includes('.')).map((iface) => iface.name);
}

/** Nom complet affiché : p3 → GigabitEthernet0/3 (ios) ou GigabitEthernet0/0/3 (vrp). */
export function displayName(dialect, name) {
  const [base, sub] = name.split('.');
  const match = /^(p|u|eth|g0\/0\/|g0\/)(\d+)$/.exec(base);
  if (!match) return name;
  const type = (TYPES[dialect] || TYPES.ios)[match[1]] || match[1];
  return `${type}${match[2]}${sub ? '.' + sub : ''}`;
}

/** Nom court : GigabitEthernet0/3 → Gi0/3. */
export function shortName(dialect, name) {
  const full = displayName(dialect, name);
  for (const [long, short] of Object.entries(SHORT[dialect] || SHORT.ios)) if (full.startsWith(long)) return short + full.slice(long.length);
  return full;
}

const ALIASES = ['gigabitethernet', 'tengigabitethernet', 'xgigabitethernet', 'fastethernet', 'ethernet', 'ge', 'xge'];

/**
 * Retrouve le nom interne d'une interface à partir de ce que l'utilisateur a tapé
 * (« g0/1 », « gi0/1 », « GigabitEthernet 0/0/1 », « fa0/3 », « p3 »…).
 * Accepte une sous-interface si `allowSub` (elle peut ne pas encore exister).
 */
export function resolveIface(dialect, def, text, { allowSub = false } = {}) {
  const raw = String(text).replace(/\s+/g, '');
  const ports = physicalPorts(def);
  const subs = (def.interfaces || []).filter((iface) => iface.name.includes('.')).map((iface) => iface.name);
  if (ports.includes(raw) || subs.includes(raw)) return raw;
  const match = /^([a-zA-Z-]+)([\d/]+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const letters = match[1].toLowerCase();
  const numbers = match[2];
  const sub = match[3];
  const typeOk = (full) => {
    const lower = full.toLowerCase();
    if (lower.startsWith(letters)) return true;
    if (letters === 'ge' || letters === 'g' || letters === 'gi' || letters === 'gig' || letters.startsWith('fa')) return lower.startsWith('gigabit');
    if (letters === 'te' || letters === 'xge' || letters === 'xg') return lower.startsWith('ten') || lower.startsWith('xgig');
    return ALIASES.some((alias) => alias.startsWith(letters) && lower.startsWith(alias));
  };
  for (const port of ports) {
    const full = displayName(dialect, port);
    const m = /^([A-Za-z]+)([\d/]+)$/.exec(full);
    if (m && m[2] === numbers && typeOk(m[1])) {
      if (!sub) return port;
      const name = `${port}.${sub}`;
      if (subs.includes(name) || allowSub) return name;
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------- utilitaires

const pad = (text, width) => String(text).padEnd(width).slice(0, Math.max(width, String(text).length));
const table = (rows, widths) => rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? String(cell) : pad(cell, widths[i]))).join(' ').trimEnd());
const macDots = (mac) => (mac ? mac.replace(/:/g, '').toLowerCase().match(/.{4}/g).join('.') : '-');
const macDashes = (mac) => (mac ? mac.replace(/:/g, '').toLowerCase().match(/.{4}/g).join('-') : '-');

/** Adresse d'ACL tapée en style console : any | host A | A wildcard → texte interne. */
function aclAddress(tokens, i) {
  const t = (tokens[i] || '').toLowerCase();
  if (t === 'any') return { text: 'any', next: i + 1 };
  if (t === 'host' && isIp(tokens[i + 1])) return { text: `host ${tokens[i + 1]}`, next: i + 2 };
  if (isIp(tokens[i]) && isIp(tokens[i + 1])) {
    const prefix = C.wildcardPrefix(tokens[i + 1]);
    if (prefix == null) return null;
    return { text: prefix === 32 ? `host ${tokens[i]}` : `${tokens[i]}/${prefix}`, next: i + 2 };
  }
  if (isIp(tokens[i]) && tokens[i + 1] === '0') return { text: `host ${tokens[i]}`, next: i + 2 }; // style VRP : « 10.0.0.5 0 »
  return null;
}

/** Règle d'ACL en style ios : « permit tcp any host 10.0.0.5 eq 80 ». */
function parseIosRule(tokens) {
  const action = (tokens[0] || '').toLowerCase();
  if (action !== 'permit' && action !== 'deny') return null;
  const proto = (tokens[1] || '').toLowerCase();
  if (!['ip', 'icmp', 'tcp', 'udp'].includes(proto)) return null;
  const src = aclAddress(tokens, 2);
  if (!src) return null;
  const dst = aclAddress(tokens, src.next);
  if (!dst) return null;
  const rule = { action, proto, src: src.text, dst: dst.text };
  const rest = tokens.slice(dst.next).map((t) => t.toLowerCase());
  if (rest[0] === 'eq' && /^\d+$/.test(rest[1] || '')) rule.port = Number(rest[1]);
  else if (rest.length) return null;
  return rule;
}

/** Règle d'ACL en style vrp : « rule 5 permit tcp source any destination 10.0.0.5 0 destination-port eq 80 ». */
function parseVrpRule(tokens) {
  let i = 0;
  let seq = null;
  if (/^\d+$/.test(tokens[i] || '')) seq = Number(tokens[i++]);
  const action = (tokens[i++] || '').toLowerCase();
  if (action !== 'permit' && action !== 'deny') return null;
  // Liste de base (2000–2999) : pas de protocole, « rule permit source … » vise tout IP.
  const next = (tokens[i] || '').toLowerCase();
  const proto = next === 'source' || next === 'destination' || next === '' ? 'ip' : (i++, next);
  if (!['ip', 'icmp', 'tcp', 'udp'].includes(proto)) return null;
  const rule = { action, proto, src: 'any', dst: 'any' };
  while (i < tokens.length) {
    const word = tokens[i].toLowerCase();
    if (word === 'source' || word === 'destination') {
      const addr = aclAddress(tokens, i + 1);
      if (!addr) return null;
      rule[word === 'source' ? 'src' : 'dst'] = addr.text;
      i = addr.next;
    } else if (word === 'destination-port' && tokens[i + 1] === 'eq' && /^\d+$/.test(tokens[i + 2] || '')) {
      rule.port = Number(tokens[i + 2]);
      i += 3;
    } else return null;
  }
  return { rule, seq: seq != null ? seq * 2 : null }; // VRP numérote 5, 10, 15… ; on garde l'ordre
}

/** Texte d'une adresse de règle en style console. */
function aclAddressText(dialect, text) {
  const match = parseMatch(text);
  if (match.any) return 'any';
  if (match.prefix === 32) return dialect === 'vrp' ? `${match.network} 0` : `host ${match.network}`;
  const wildcard = C.maskOf(match.prefix).split('.').map((n) => 255 - Number(n)).join('.');
  return `${match.network} ${wildcard}`;
}

function ruleLine(dialect, rule, seq) {
  const port = rule.port != null ? (dialect === 'vrp' ? ` destination-port eq ${rule.port}` : ` eq ${rule.port}`) : '';
  if (dialect === 'vrp') {
    const src = parseMatch(rule.src).any ? '' : ` source ${aclAddressText('vrp', rule.src)}`;
    const dst = parseMatch(rule.dst).any ? '' : ` destination ${aclAddressText('vrp', rule.dst)}`;
    return `rule ${seq / 2} ${rule.action} ${rule.proto}${src}${dst}${port}`;
  }
  return `${seq} ${rule.action} ${rule.proto} ${aclAddressText('ios', rule.src)} ${aclAddressText('ios', rule.dst)}${port}`;
}

// --------------------------------------------------------------- configuration écrite

/** Configuration courante d'un équipement, telle que « show running-config » l'affiche. */
export function runningConfig(def, live) {
  const dialect = systemOf(def).dialect;
  const out = [];
  const sep = dialect === 'vrp' ? '#' : '!';
  const mask = (prefix) => C.maskOf(prefix);
  if (dialect === 'pc') return [];
  out.push(sep, dialect === 'vrp' ? `sysname ${def.name}` : `hostname ${def.name}`, sep);
  if (def.type === 'switch') {
    const vlans = Object.entries(def.vlans || {}).filter(([id]) => id !== '1');
    if (vlans.length) {
      if (dialect === 'vrp') {
        out.push(`vlan batch ${vlans.map(([id]) => id).join(' ')}`, sep);
        for (const [id, name] of vlans) out.push(`vlan ${id}`, ` description ${name}`, sep);
      } else {
        for (const [id, name] of vlans) out.push(`vlan ${id}`, ` name ${name}`, sep);
      }
    }
    for (const port of physicalPorts(def)) {
      const config = (def.ports || {})[port] || {};
      const lines = [];
      if (config.description) lines.push(` description ${config.description}`);
      if (config.mode === 'trunk') {
        if (dialect === 'vrp') {
          lines.push(' port link-type trunk', ` port trunk allow-pass vlan ${config.allowed ? config.allowed.join(' ') : 'all'}`);
          if (config.native) lines.push(` port trunk pvid vlan ${config.native}`);
        } else {
          lines.push(' switchport mode trunk');
          if (config.allowed) lines.push(` switchport trunk allowed vlan ${config.allowed.join(',')}`);
          if (config.native) lines.push(` switchport trunk native vlan ${config.native}`);
        }
      } else if (config.vlan) {
        lines.push(...(dialect === 'vrp' ? [' port link-type access', ` port default vlan ${config.vlan}`] : [' switchport mode access', ` switchport access vlan ${config.vlan}`]));
      }
      if (config.security) {
        const sec = config.security;
        const learned = live && live.security && live.security.get(port) ? [...live.security.get(port).learned] : [];
        if (dialect === 'vrp') {
          lines.push(' port-security enable', ` port-security max-mac-num ${sec.maximum || 1}`);
          if (sec.violation && sec.violation !== 'restrict') lines.push(` port-security protect-action ${sec.violation === 'shutdown' ? 'error-down' : sec.violation}`);
          if (sec.sticky) lines.push(' port-security mac-address sticky');
          for (const mac of [...(sec.macs || []), ...learned]) lines.push(` port-security mac-address${sec.sticky ? ' sticky' : ''} ${macDashes(mac)} vlan ${config.vlan || 1}`);
        } else {
          lines.push(' switchport port-security');
          if ((sec.maximum || 1) !== 1) lines.push(` switchport port-security maximum ${sec.maximum}`);
          if (sec.violation && sec.violation !== 'shutdown') lines.push(` switchport port-security violation ${sec.violation}`);
          if (sec.sticky) lines.push(' switchport port-security mac-address sticky');
          for (const mac of sec.macs || []) lines.push(` switchport port-security mac-address ${macDots(mac)}`);
          for (const mac of learned) lines.push(` switchport port-security mac-address sticky ${macDots(mac)}`);
        }
      }
      if (config.shutdown) lines.push(' shutdown');
      if (lines.length) out.push(`interface ${displayName(dialect, port)}`, ...lines, sep);
    }
  } else {
    if (dialect === 'vrp') {
      for (const [name, rules] of Object.entries(def.acls || {})) {
        out.push(`acl name ${name} advance`, ...rules.map((rule, i) => ` ${ruleLine('vrp', rule, (i + 1) * 10)}`), sep);
      }
    }
    for (const iface of def.interfaces || []) {
      const lines = [];
      if (iface.description) lines.push(` description ${iface.description}`);
      if (iface.vlan) lines.push(dialect === 'vrp' ? ` dot1q termination vid ${iface.vlan}` : ` encapsulation dot1Q ${iface.vlan}`);
      if (def.type === 'firewall' && dialect === 'ios') {
        if (iface.zone) lines.push(` nameif ${iface.zone}`);
        if (iface.level != null || iface.zone) lines.push(` security-level ${iface.level != null ? iface.level : ({ inside: 100, dmz: 50, outside: 0 }[iface.zone] || 0)}`);
      }
      if (iface.ip) lines.push(` ip address ${iface.ip} ${mask(iface.prefix)}`);
      else if (!iface.name.includes('.') && def.type !== 'host' && def.type !== 'server') lines.push(dialect === 'vrp' ? '' : ' no ip address');
      if (dialect === 'vrp') {
        if (iface.acl && iface.acl.in) lines.push(` traffic-filter inbound acl name ${iface.acl.in}`);
        if (iface.acl && iface.acl.out) lines.push(` traffic-filter outbound acl name ${iface.acl.out}`);
        if (iface.nat === 'outside') {
          for (const rule of def.nat || []) {
            if (rule.type === 'static') lines.push(` nat static global ${rule.outside} inside ${rule.inside}`);
            else lines.push(` nat outbound${rule.acl ? ' ' + rule.acl : ''}`);
          }
        }
      } else {
        if (iface.nat) lines.push(` ip nat ${iface.nat}`);
        if (iface.acl && iface.acl.in) lines.push(` ip access-group ${iface.acl.in} in`);
        if (iface.acl && iface.acl.out) lines.push(` ip access-group ${iface.acl.out} out`);
      }
      if (iface.shutdown) lines.push(' shutdown');
      out.push(`interface ${displayName(dialect, iface.name)}`, ...lines.filter(Boolean), sep);
    }
    if (def.type !== 'host' && def.type !== 'server') {
      for (const route of def.routes || []) {
        out.push(dialect === 'vrp' ? `ip route-static ${route.network} ${mask(route.prefix)} ${route.via}` : `ip route ${route.network} ${mask(route.prefix)} ${route.via}`);
      }
      if ((def.routes || []).length) out.push(sep);
      if (dialect === 'ios') {
        for (const [name, rules] of Object.entries(def.acls || {})) {
          out.push(`ip access-list extended ${name}`, ...rules.map((rule, i) => ` ${ruleLine('ios', rule, (i + 1) * 10)}`), sep);
        }
        const outside = (def.interfaces || []).find((iface) => iface.nat === 'outside');
        for (const rule of def.nat || []) {
          if (rule.type === 'static') out.push(`ip nat inside source static ${rule.inside} ${rule.outside}`);
          else out.push(`ip nat inside source ${rule.acl ? `list ${rule.acl}` : 'list ANY'} interface ${outside ? displayName('ios', outside.name) : '?'} overload`);
        }
        if ((def.nat || []).length) out.push(sep);
      }
    }
  }
  out.push(dialect === 'vrp' ? 'return' : 'end');
  return out;
}

// --------------------------------------------------------------------- les commandes

/**
 * Crée une session de console sur un équipement.
 * @param {Object} api {
 *   scenario(): scénario courant ; device(id): équipement vivant (ou null) ;
 *   lang(): 'fr' | 'en' ; traffic?(): état du trafic }
 */
export function createConsole(api, deviceId) {
  const def0 = () => api.scenario().devices.find((def) => def.id === deviceId);
  const system = systemOf(def0());
  const dialect = system.dialect;
  const state = { mode: dialect === 'pc' ? 'pc' : 'user', iface: null, acl: null, vlan: null, history: [] };
  const err = (error) => (error && error.text ? error.text[api.lang ? api.lang() : 'fr'] : String(error.message || error));

  const name = () => def0().name;
  function prompt() {
    const n = name();
    if (dialect === 'pc') return `C:\\Users\\steve>`;
    if (dialect === 'vrp') {
      if (state.mode === 'user') return `<${n}>`;
      if (state.mode === 'config') return `[${n}]`;
      if (state.mode === 'if') return `[${n}-${displayName('vrp', state.iface)}]`;
      if (state.mode === 'acl') return `[${n}-acl-adv-${state.acl}]`;
      if (state.mode === 'vlan') return `[${n}-vlan${state.vlan}]`;
    }
    if (state.mode === 'user') return `${n}>`;
    if (state.mode === 'priv') return `${n}#`;
    if (state.mode === 'config') return `${n}(config)#`;
    if (state.mode === 'if') return `${n}(config-${state.iface.includes('.') ? 'subif' : 'if'})#`;
    if (state.mode === 'acl') return `${n}(config-ext-nacl)#`;
    if (state.mode === 'vlan') return `${n}(config-vlan)#`;
    return `${n}>`;
  }

  // Résultat d'une commande : { lines, scenario?, run? }
  const ok = (lines = []) => ({ lines });
  const apply = (scenario, lines = []) => ({ lines, scenario });
  const fail = (message) => ({ lines: [message], error: true });
  const invalid = (at = 0) => (dialect === 'vrp'
    ? fail(`${' '.repeat(prompt().length + at)}^\nError: Unrecognized command found at '^' position.`)
    : fail(`${' '.repeat(prompt().length + at)}^\n% Invalid input detected at '^' marker.`));
  const incomplete = () => fail(dialect === 'vrp' ? 'Error: Incomplete command found at \'^\' position.' : '% Incomplete command.');

  // ---------- affichages
  const live = () => api.device(deviceId);
  function ifaceBrief() {
    const def = def0();
    const device = live();
    if (def.type === 'switch') {
      const rows = physicalPorts(def).map((port) => {
        const cabled = api.scenario().links.some((l) => l.a === `${def.id}:${port}` || l.b === `${def.id}:${port}`);
        const iface = device && device.iface(port);
        const config = (def.ports || {})[port] || {};
        const status = config.shutdown ? 'administratively down' : iface && iface.errDisabled ? 'err-disabled' : cabled ? 'up' : 'down';
        return [shortName(dialect, port), 'unassigned', 'YES', 'unset', status, status === 'up' ? 'up' : 'down'];
      });
      return table([['Interface', 'IP-Address', 'OK?', 'Method', 'Status', 'Protocol'], ...rows], [22, 15, 4, 7, 22]);
    }
    const rows = (device ? device.interfaces : def.interfaces).map((iface) => {
      const cabled = api.scenario().links.some((l) => l.a === `${def.id}:${(iface.parent || iface.name)}` || l.b === `${def.id}:${(iface.parent || iface.name)}`);
      const down = iface.shutdown || (device && device.isDown && device.isDown(iface.name));
      const status = iface.shutdown ? 'administratively down' : down ? 'down' : cabled ? 'up' : 'down';
      return [shortName(dialect, iface.name), iface.ip || 'unassigned', 'YES', iface.ip ? 'manual' : 'unset', status, status === 'up' ? 'up' : 'down'];
    });
    if (dialect === 'vrp') {
      return table([['Interface', 'IP Address/Mask', 'Physical', 'Protocol'], ...rows.map((r, i) => {
        const iface = (device ? device.interfaces : def.interfaces)[i];
        return [displayName('vrp', iface.name), iface.ip ? `${iface.ip}/${iface.prefix}` : 'unassigned', r[4] === 'administratively down' ? '*down' : r[4], r[5]];
      })], [28, 20, 10]);
    }
    return table([['Interface', 'IP-Address', 'OK?', 'Method', 'Status', 'Protocol'], ...rows], [22, 15, 4, 7, 22]);
  }

  function routeTable() {
    const device = live();
    if (!device || !device.routes) return ['% Routing is not available on this device.'];
    const routes = device.routes();
    if (dialect === 'vrp') {
      return ['Route Flags: R - relay, D - download to fib', '------------------------------------------------------------------------------',
        'Routing Tables: Public', '',
        ...table([['Destination/Mask', 'Proto', 'Pre', 'Cost', 'NextHop', 'Interface'], ...routes.map((r) => {
          const out = r.iface || ((device.interfaces.find((i) => i.ip && inNetwork(r.via, i.ip, i.prefix)) || {}).name) || '-';
          return [`${r.network}/${r.prefix}`, r.kind === 'connected' ? 'Direct' : 'Static', r.kind === 'connected' ? '0' : '60', '0', r.via || (device.iface(out) || {}).ip || '-', displayName('vrp', out)];
        })], [20, 8, 5, 6, 16])];
    }
    const lines = ['Codes: C - connected, S - static, * - candidate default', ''];
    const gw = routes.find((r) => r.prefix === 0);
    lines.push(gw ? `Gateway of last resort is ${gw.via} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    for (const r of routes) {
      if (r.kind === 'connected') lines.push(`C        ${r.network}/${r.prefix} is directly connected, ${displayName('ios', r.iface)}`);
      else lines.push(`S${r.prefix === 0 ? '*' : ' '}       ${r.network}/${r.prefix} [1/0] via ${r.via}`);
    }
    return lines;
  }

  function arpTable() {
    const device = live();
    if (!device || !device.arpCache) return ['% No ARP table.'];
    const own = device.interfaces.filter((i) => i.ip).map((i) => [i.ip, i.mac, i.name, true]);
    const learned = [...device.arpCache.entries()].map(([ip, mac]) => {
      const out = device.interfaces.find((i) => i.ip && inNetwork(ip, i.ip, i.prefix));
      return [ip, mac, out ? out.name : '-', false];
    });
    if (dialect === 'pc') {
      return ['', `Interface: ${(device.primary() || {}).ip || '-'} --- 0x3`, '  Internet Address      Physical Address      Type',
        ...learned.map(([ip, mac]) => `  ${pad(ip, 21)} ${pad(mac.toLowerCase().replace(/:/g, '-'), 21)} dynamic`)];
    }
    if (dialect === 'vrp') {
      return table([['IP ADDRESS', 'MAC ADDRESS', 'EXPIRE(M)', 'TYPE', 'INTERFACE'],
        ...[...own, ...learned].map(([ip, mac, iface, mine]) => [ip, macDashes(mac), mine ? '' : '20', mine ? 'I -' : 'D-0', displayName('vrp', iface)])], [16, 16, 10, 6]);
    }
    return table([['Protocol', 'Address', 'Age (min)', 'Hardware Addr', 'Type', 'Interface'],
      ...[...own, ...learned].map(([ip, mac, iface, mine]) => ['Internet', ip, mine ? '-' : '0', macDots(mac), 'ARPA', displayName('ios', iface)])], [9, 16, 10, 15, 5]);
  }

  function macTable() {
    const device = live();
    if (!device || !device.macTable) return ['% This device has no MAC address table.'];
    const rows = [...device.macTable.entries()].map(([key, port]) => {
      const [vlan, mac] = key.includes('|') ? key.split('|') : ['1', key];
      return [vlan, mac, port];
    });
    if (dialect === 'vrp') {
      return table([['MAC Address', 'VLAN', 'Learned-From', 'Type'], ...rows.map(([vlan, mac, port]) => [macDashes(mac), vlan, displayName('vrp', port), 'dynamic'])], [16, 6, 24]);
    }
    return ['          Mac Address Table', '-------------------------------------------', '',
      ...table([['Vlan', 'Mac Address', 'Type', 'Ports'], ...rows.map(([vlan, mac, port]) => [vlan, macDots(mac), 'DYNAMIC', shortName('ios', port)])], [6, 16, 9]),
      `Total Mac Addresses for this criterion: ${rows.length}`];
  }

  function vlanBrief() {
    const def = def0();
    if (def.type !== 'switch') return ['% VLANs are only on switches.'];
    const vlans = { 1: 'default', ...(def.vlans || {}) };
    const ports = physicalPorts(def);
    const member = (id) => ports.filter((p) => { const c = (def.ports || {})[p] || {}; return c.mode !== 'trunk' && (c.vlan || 1) === Number(id); });
    if (dialect === 'vrp') {
      return ['The total number of vlans is : ' + Object.keys(vlans).length, '',
        ...table([['VID', 'Type', 'Ports'], ...Object.keys(vlans).map((id) => [id, 'common', member(id).map((p) => shortName('vrp', p)).join(' ')])], [6, 8])];
    }
    return table([['VLAN', 'Name', 'Status', 'Ports'], ...Object.entries(vlans).map(([id, vname]) => [id, vname, 'active', member(id).map((p) => shortName('ios', p)).join(', ')])], [5, 20, 10]);
  }

  function trunks() {
    const def = def0();
    const rows = physicalPorts(def).filter((p) => ((def.ports || {})[p] || {}).mode === 'trunk').map((p) => {
      const c = def.ports[p];
      return [shortName('ios', p), 'on', '802.1q', 'trunking', String(c.native || 1), c.allowed ? c.allowed.join(',') : '1-4094'];
    });
    if (!rows.length) return [];
    return table([['Port', 'Mode', 'Encapsulation', 'Status', 'Native vlan', 'Vlans allowed'], ...rows], [10, 6, 14, 10, 12]);
  }

  function portSecurity() {
    const device = live();
    const def = def0();
    if (def.type !== 'switch') return ['% Port security is a switch feature.'];
    const rows = Object.entries(def.ports || {}).filter(([, c]) => c.security).map(([port, c]) => {
      const sec = device && device.security ? device.security.get(port) : null;
      const count = sec ? sec.macs.length : (c.security.macs || []).length;
      const errdis = device && device.iface(port) && device.iface(port).errDisabled;
      return [shortName(dialect, port), String(c.security.maximum || 1), String(count), String(sec ? sec.violations : 0), errdis ? 'Shutdown (err-disabled)' : (c.security.violation || 'shutdown').replace(/^./, (x) => x.toUpperCase())];
    });
    return ['Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action',
      '                (Count)       (Count)          (Count)', '-------------------------------------------------------------------',
      ...table(rows, [13, 15, 13, 19])];
  }

  function accessLists() {
    const device = live();
    const def = def0();
    const lines = [];
    for (const [aclName, rules] of Object.entries(def.acls || {})) {
      const hits = device && device.aclHits ? device.aclHits.get(aclName) || [] : [];
      if (dialect === 'vrp') {
        lines.push(`Advanced ACL ${aclName}, ${rules.length} rule${rules.length > 1 ? 's' : ''}`, 'Acl\'s step is 5');
        rules.forEach((rule, i) => lines.push(` ${ruleLine('vrp', rule, (i + 1) * 10)} (${hits[i] || 0} matches)`));
      } else {
        lines.push(`Extended IP access list ${aclName}`);
        rules.forEach((rule, i) => lines.push(`    ${ruleLine('ios', rule, (i + 1) * 10)}${hits[i] ? ` (${hits[i]} matches)` : ''}`));
      }
    }
    return lines.length ? lines : [dialect === 'vrp' ? 'Info: No ACL exists.' : ''];
  }

  function natTable() {
    const device = live();
    if (!device || !device.nat) return ['% NAT is not available on this device.'];
    const rows = device.nat.entries.map((e) => [e.proto.toLowerCase(), `${e.outside}${e.outsidePort != null ? ':' + e.outsidePort : ''}`, `${e.inside}${e.insidePort != null ? ':' + e.insidePort : ''}`, e.remote]);
    if (dialect === 'vrp') return [`  NAT Session Table Information:`, ...rows.map((r) => `     Protocol : ${r[0]}  SrcAddr/Port : ${r[2]}  DestAddr : ${r[3]}  NAT-Info New SrcAddr/Port : ${r[1]}`), `  Total : ${rows.length}`];
    return table([['Pro', 'Inside global', 'Inside local', 'Outside global'], ...rows], [5, 22, 22]);
  }

  function connTable() {
    const device = live();
    if (!device || !device.sessions) return ['% This device does not keep sessions (it is not a firewall).'];
    const rows = [...device.sessions.values()];
    return [`${rows.length} in use, ${rows.length} most used`, ...rows.map((s) => `${s.proto} inside ${s.from} outside ${s.to}, idle 0:00:01, bytes ${s.hits * 64}, flags ${s.proto === 'TCP' ? 'UIO' : '-'}`)];
  }

  function version() {
    const def = def0();
    const model = modelOf(def);
    const specs = model ? specsOf(model) : null;
    const desc = model ? model.description[api.lang ? api.lang() : 'fr'] : '';
    return [`${system.name} — ${model ? model.name : def.type}`,
      `${def.name} uptime is ${Math.max(0, Math.round(((api.now && api.now()) || 0) / 1000))} seconds (simulated)`,
      specs ? `${specs.ports} ports : ${specs.portSummary}` : '',
      specs && specs.switchingCapacity ? `Switching capacity ${formatSpeed(specs.switchingCapacity)}, forwarding ${specs.forwardingRate.toFixed(1)} Mpps` : '',
      '', ...wrapText(desc, 76)].filter((line, i) => line !== '' || i === 3);
  }

  function neighbors() {
    const scenario = api.scenario();
    const rows = [];
    for (const link of scenario.links) {
      const [aDev, aPort] = link.a.split(':');
      const [bDev, bPort] = link.b.split(':');
      let mine = null; let other = null; let otherPort = null;
      if (aDev === deviceId) { mine = aPort; other = bDev; otherPort = bPort; } else if (bDev === deviceId) { mine = bPort; other = aDev; otherPort = aPort; }
      if (!mine) continue;
      const odef = scenario.devices.find((d) => d.id === other);
      const odialect = systemOf(odef).dialect === 'pc' ? 'ios' : systemOf(odef).dialect;
      rows.push([odef.name, shortName(dialect, mine), (MODELS[odef.model] || {}).name || odef.type, shortName(odialect, otherPort)]);
    }
    if (dialect === 'vrp') return table([['Local Intf', 'Neighbor Dev', 'Neighbor Intf', 'Exptime'], ...rows.map((r) => [r[1], r[0], r[3], '120'])], [14, 16, 16]);
    return ['Capability Codes: R - Router, S - Switch, H - Host, F - Firewall', '',
      ...table([['Device ID', 'Local Intrfce', 'Platform', 'Port ID'], ...rows], [16, 15, 30])];
  }

  // ---------- commandes du PC
  function pcCommand(tokens, line) {
    const cmd = (tokens[0] || '').toLowerCase();
    const def = def0();
    const device = live();
    const nic = (device && device.primary()) || (def.interfaces || [])[0] || {};
    if (!cmd) return ok();
    if (cmd === 'help' || cmd === '?') {
      return ok(['Commandes / Commands:', '  ipconfig [/all] [/renew]   adresse IP, masque, passerelle (DHCP : /renew)', '  ping <adresse|nom>         teste la connexion (4 paquets)',
        '  tracert <adresse|nom>      chemin routeur par routeur', '  arp -a                     cache ARP', '  nslookup <nom>             interroge le serveur DNS',
        '  curl http://<site>/        demande une page web', '  netsh interface ip set address eth0 static <ip> <masque> [passerelle]',
        '  netsh interface ip set dns eth0 static <ip>', '  hostname | cls | exit']);
    }
    if (cmd === 'hostname') return ok([def.name]);
    if (cmd === 'ipconfig') {
      if ((tokens[1] || '').toLowerCase() === '/renew') return { lines: ['', 'Requesting an address from the DHCP server...'], run: { kind: 'dhcp', steps: [{ action: 'dhcp', from: deviceId }] } };
      const all = (tokens[1] || '').toLowerCase() === '/all';
      const lines = ['', 'Windows IP Configuration', '', `Ethernet adapter ${nic.name || 'eth0'}:`, ''];
      if (all) lines.push(`   Physical Address. . . . . . . . . : ${(nic.mac || '').replace(/:/g, '-')}`, `   DHCP Enabled. . . . . . . . . . . : ${def.interfaces[0].ip ? 'No' : 'Yes'}`);
      lines.push(`   IPv4 Address. . . . . . . . . . . : ${nic.ip || '0.0.0.0'}`, `   Subnet Mask . . . . . . . . . . . : ${nic.prefix ? C.maskOf(nic.prefix) : '0.0.0.0'}`,
        `   Default Gateway . . . . . . . . . : ${(device && device.gateway) || def.gateway || ''}`);
      if (all) lines.push(`   DNS Servers . . . . . . . . . . . : ${(device && device.dnsServer) || def.dns || ''}`);
      return ok(lines);
    }
    if (cmd === 'arp' && (tokens[1] || '').toLowerCase() === '-a') return ok(arpTable());
    if (cmd === 'cls' || cmd === 'clear') return { lines: [], clear: true };
    if (cmd === 'ping' && tokens[1]) return pingRun(tokens[1], 4);
    if ((cmd === 'tracert' || cmd === 'traceroute') && tokens[1]) return traceRun(tokens[1]);
    if (cmd === 'nslookup' && tokens[1]) return { lines: [`Server:  ${(device && device.dnsServer) || def.dns || 'Unknown'}`, ''], run: { kind: 'dns', name: tokens[1], steps: [{ action: 'dns', from: deviceId, name: tokens[1] }] } };
    if ((cmd === 'curl' || cmd === 'start') && tokens[1]) return { lines: [], run: { kind: 'http', url: tokens[1], steps: [{ action: 'http', from: deviceId, url: tokens[1] }] } };
    if (cmd === 'netsh') {
      const words = line.replace(/"/g, '').split(/\s+/).map((w) => w.toLowerCase());
      const at = words.indexOf('static');
      const iface = (def.interfaces || [])[0];
      if (words[1] === 'interface' && words[2] === 'ip' && words[3] === 'set' && words[4] === 'address' && at > 0) {
        const raw = line.replace(/"/g, '').split(/\s+/);
        const ip = raw[at + 1];
        const prefix = C.prefixOf(raw[at + 2] || '');
        if (!isIp(ip) || prefix == null) return fail('The syntax supplied for this command is not valid. Check help for the correct syntax.');
        try {
          let next = B.setAddress(api.scenario(), deviceId, iface.name, ip, prefix);
          if (raw[at + 3]) next = B.updateDevice(next, deviceId, { gateway: raw[at + 3] });
          return apply(next, ['Ok.']);
        } catch (e) { return fail(err(e)); }
      }
      if (words[1] === 'interface' && words[2] === 'ip' && words[3] === 'set' && words[4] === 'dns' && at > 0) {
        const raw = line.replace(/"/g, '').split(/\s+/);
        try { return apply(B.updateDevice(api.scenario(), deviceId, { dns: raw[at + 1] }), ['Ok.']); } catch (e) { return fail(err(e)); }
      }
      return fail('The following command was not found: ' + line.slice(6));
    }
    return fail(`'${tokens[0]}' is not recognized as an internal or external command,\noperable program or batch file. (help : liste des commandes)`);
  }

  // ---------- ping / traceroute
  const targetOf = (text) => {
    if (isIp(text)) return text;
    const def = api.scenario().devices.find((d) => d.name.toLowerCase() === text.toLowerCase() || d.id === text);
    if (def) { const iface = (def.interfaces || []).find((i) => i.ip); return iface ? iface.ip : null; }
    return null;
  };
  function pingRun(text, count) {
    const ip = targetOf(text);
    if (!ip) {
      if (dialect === 'pc') return { lines: [], run: { kind: 'ping', count, target: text, name: text, steps: [{ action: 'ping', from: deviceId, to: text, count }] }, nameLookup: true };
      return fail(dialect === 'vrp' ? `Error: The host ${text} is unknown.` : `% Unrecognized host or address, or protocol not running.`);
    }
    const head = dialect === 'pc' ? [`Pinging ${ip} with 32 bytes of data:`]
      : dialect === 'vrp' ? [`  PING ${ip}: 56  data bytes, press CTRL_C to break`]
        : ['Type escape sequence to abort.', `Sending ${count}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`];
    return { lines: head, run: { kind: 'ping', count, target: ip, steps: [{ action: 'ping', from: deviceId, to: ip, count }] } };
  }
  function traceRun(text) {
    const ip = targetOf(text);
    if (!ip) return fail(dialect === 'pc' ? `Unable to resolve target system name ${text}.` : '% Unrecognized host or address.');
    const steps = [];
    for (let ttl = 1; ttl <= 8; ttl++) steps.push({ action: 'ping', from: deviceId, to: ip, ttl, count: 1 });
    const head = dialect === 'pc' ? ['', `Tracing route to ${ip} over a maximum of 8 hops`, '']
      : dialect === 'vrp' ? [` traceroute to ${ip}, max hops: 8 ,packet length: 40,press CTRL_C to break`]
        : ['Type escape sequence to abort.', `Tracing the route to ${ip}`];
    return { lines: head, run: { kind: 'trace', target: ip, steps } };
  }

  // ---------- table des commandes
  // Chaque entrée : modes où elle existe, mots (un mot finissant par « * » ne s'abrège pas),
  // arguments { kind }, aide, et fonction. Les mots « {x} » sont des arguments.
  const entries = [];
  const add = (modes, pattern, help, run) => entries.push({ modes, words: pattern.split(' '), help, run });
  const SHOW = dialect === 'vrp' ? 'display' : 'show';
  const ALLSHOW = dialect === 'vrp' ? ['user', 'config', 'if', 'acl', 'vlan'] : ['user', 'priv'];
  const PRIV = dialect === 'vrp' ? ['user', 'config', 'if', 'acl', 'vlan'] : ['priv'];

  // Mise à jour d'un scénario en attrapant les erreurs de configuration.
  const change = (fn, lines = []) => {
    try {
      const next = fn(api.scenario());
      const { errors } = validateScenario(next);
      if (errors.length) return fail(`${dialect === 'vrp' ? 'Error:' : '%'} ${errors[0]}`);
      return apply(next, lines);
    } catch (e) {
      return fail(dialect === 'vrp' ? `Error: ${err(e)}` : `% ${err(e)}`);
    }
  };
  const here = () => state.iface;
  const def = () => def0();
  const isSwitch = () => def().type === 'switch';
  const isL3 = () => def().type === 'router' || def().type === 'firewall';
  const needIfaceMode = (kind) => (kind === 'switch' ? isSwitch() : isL3());

  // Affichages communs
  add(ALLSHOW, `${SHOW} version`, 'System hardware and software status', () => ok(version()));
  add(ALLSHOW, dialect === 'vrp' ? 'display current-configuration' : 'show running-config', 'Current operating configuration', () => ok(runningConfig(def(), live())));
  add(ALLSHOW, dialect === 'vrp' ? 'display ip interface brief' : 'show ip interface brief', 'Brief summary of IP status', () => ok(ifaceBrief()));
  if (dialect === 'ios') add(ALLSHOW, 'show interfaces status', 'Interface line status', () => ok(ifaceBrief()));
  add(ALLSHOW, dialect === 'vrp' ? 'display ip routing-table' : 'show ip route', 'IP routing table', () => ok(routeTable()));
  add(ALLSHOW, dialect === 'vrp' ? 'display arp' : 'show arp', 'ARP table', () => ok(arpTable()));
  if (dialect === 'ios') add(ALLSHOW, 'show ip arp', 'IP ARP table', () => ok(arpTable()));
  add(ALLSHOW, dialect === 'vrp' ? 'display mac-address' : 'show mac address-table', 'MAC forwarding table', () => ok(macTable()));
  add(ALLSHOW, dialect === 'vrp' ? 'display vlan' : 'show vlan brief', 'VLAN summary', () => ok(vlanBrief()));
  if (dialect === 'ios') add(ALLSHOW, 'show interfaces trunk', 'Trunk ports', () => ok(trunks()));
  add(ALLSHOW, dialect === 'vrp' ? 'display port-security' : 'show port-security', 'Port security status', () => ok(portSecurity()));
  add(ALLSHOW, dialect === 'vrp' ? 'display acl all' : 'show access-lists', 'Access lists and their match counters', () => ok(accessLists()));
  add(ALLSHOW, dialect === 'vrp' ? 'display nat session all' : 'show ip nat translations', 'NAT translation table', () => ok(natTable()));
  if (dialect === 'ios') add(ALLSHOW, 'show conn', 'Firewall sessions (stateful table)', () => ok(connTable()));
  else add(ALLSHOW, 'display firewall session table', 'Firewall sessions (stateful table)', () => ok(connTable()));
  add(ALLSHOW, dialect === 'vrp' ? 'display lldp neighbor brief' : 'show cdp neighbors', 'Directly connected neighbors', () => ok(neighbors()));
  add(PRIV.concat(dialect === 'ios' ? ['user'] : []), 'ping {target}', 'Send ICMP echo messages', (a) => pingRun(a.target, 5));
  add(PRIV.concat(dialect === 'ios' ? ['user'] : []), dialect === 'vrp' ? 'tracert {target}' : 'traceroute {target}', 'Trace route to destination', (a) => traceRun(a.target));

  if (dialect === 'ios') {
    add(['user'], 'enable', 'Turn on privileged commands', () => { state.mode = 'priv'; return ok(); });
    add(['priv'], 'disable', 'Turn off privileged commands', () => { state.mode = 'user'; return ok(); });
    add(['priv'], 'configure terminal', 'Enter configuration mode', () => { state.mode = 'config'; return ok(['Enter configuration commands, one per line.  End with CNTL/Z.']); });
    add(['priv'], 'write memory', 'Save the configuration', () => ok(['Building configuration...', '[OK]']));
    add(['priv'], 'copy running-config startup-config', 'Save the configuration', () => ok(['Destination filename [startup-config]?', 'Building configuration...', '[OK]']));
    add(['priv'], 'clear ip nat translation *', 'Clear NAT translations', () => { const d = live(); if (d && d.nat) d.nat.entries.length = 0; return ok(); });
    add(['priv'], 'clear arp-cache', 'Clear the ARP cache', () => { const d = live(); if (d && d.arpCache) d.arpCache.clear(); return ok(); });
    add(['config'], 'hostname {word}', 'Set system\'s network name', (a) => change((s) => C.setHostname(s, deviceId, a.word)));
    add(['config', 'if', 'acl', 'vlan'], 'interface {iface}', 'Select an interface to configure', (a) => enterInterface(a.iface));
    add(['config'], 'no interface {iface}', 'Delete a sub-interface', (a) => (a.iface.includes('.') ? change((s) => C.removeSubinterface(s, deviceId, a.iface)) : invalid(3)));
    add(['config'], 'ip route {ip} {mask} {ip2}', 'Establish a static route', (a) => (isL3() ? change((s) => C.addRoute(s, deviceId, a.ip, a.mask, a.ip2)) : invalid(0)));
    add(['config'], 'no ip route {ip} {mask} {ip2}', 'Remove a static route', (a) => change((s) => C.removeRoute(s, deviceId, a.ip, a.mask, a.ip2)));
    add(['config', 'acl'], 'ip access-list extended {word}', 'Named extended access list', (a) => {
      if (!isL3()) return invalid(0);
      const r = change((s) => C.ensureAcl(s, deviceId, a.word));
      if (!r.error) { state.mode = 'acl'; state.acl = a.word; }
      return r;
    });
    add(['config'], 'no ip access-list extended {word}', 'Delete an access list', (a) => change((s) => C.removeAcl(s, deviceId, a.word)));
    add(['config'], 'access-list {num} {rest}', 'Numbered access list rule', (a) => {
      const rule = parseIosRule(a.rest.split(' '));
      return rule ? change((s) => C.addAclRule(s, deviceId, String(a.num), rule)) : incomplete();
    });
    add(['config'], 'ip nat inside source list {word} interface {iface} overload', 'Translate inside sources (PAT)', (a) => change((s) => C.addNatRule(s, deviceId, { type: 'overload', acl: def().acls && def().acls[a.word] ? a.word : undefined })));
    add(['config'], 'ip nat inside source static {ip} {ip2}', 'Static translation', (a) => change((s) => C.addNatRule(s, deviceId, { type: 'static', inside: a.ip, outside: a.ip2 })));
    add(['config'], 'no ip nat inside source static {ip} {ip2}', 'Remove a static translation', (a) => change((s) => C.removeNatRule(s, deviceId, { type: 'static', inside: a.ip })));
    add(['config'], 'no ip nat inside source list {word} interface {iface} overload', 'Remove PAT', () => change((s) => C.removeNatRule(s, deviceId, { type: 'overload' })));
    add(['config', 'vlan'], 'vlan {num}', 'VLAN commands', (a) => {
      if (!isSwitch()) return invalid(0);
      const r = change((s) => C.addVlan(s, deviceId, a.num));
      if (!r.error) { state.mode = 'vlan'; state.vlan = a.num; }
      return r;
    });
    add(['config'], 'no vlan {num}', 'Delete a VLAN', (a) => change((s) => C.removeVlan(s, deviceId, a.num)));
    add(['vlan'], 'name {word}', 'ASCII name of the VLAN', (a) => change((s) => C.addVlan(s, deviceId, state.vlan, a.word)));
    // interface (routeur, pare-feu, switch)
    add(['if'], 'ip address {ip} {mask}', 'Set the IP address of an interface', (a) => (isL3() ? change((s) => B.setAddress(s, deviceId, here(), a.ip, a.mask)) : fail('% IP addresses can only be set on a routed interface. Use a router or a firewall.')));
    add(['if'], 'no ip address', 'Remove the IP address', () => change((s) => B.setAddress(s, deviceId, here(), null)));
    add(['if'], 'shutdown', 'Shutdown the selected interface', () => change((s) => C.setShutdown(s, deviceId, here(), true)));
    add(['if'], 'no shutdown', 'Enable the interface', () => change((s) => C.setShutdown(s, deviceId, here(), false), [`%LINK-5-CHANGED: Interface ${displayName('ios', here())}, changed state to up`]));
    add(['if'], 'description {rest}', 'Interface specific description', (a) => change((s) => C.setDescription(s, deviceId, here(), a.rest)));
    add(['if'], 'encapsulation dot1q {num}', 'IEEE 802.1Q Virtual LAN', (a) => change((s) => C.setSubinterfaceVlan(s, deviceId, here(), a.num)));
    add(['if'], 'ip access-group {word} in', 'Apply an access list inbound', (a) => change((s) => C.bindAcl(s, deviceId, here(), 'in', a.word)));
    add(['if'], 'ip access-group {word} out', 'Apply an access list outbound', (a) => change((s) => C.bindAcl(s, deviceId, here(), 'out', a.word)));
    add(['if'], 'no ip access-group {word} in', 'Remove the inbound access list', () => change((s) => C.bindAcl(s, deviceId, here(), 'in', null)));
    add(['if'], 'no ip access-group {word} out', 'Remove the outbound access list', () => change((s) => C.bindAcl(s, deviceId, here(), 'out', null)));
    add(['if'], 'ip nat inside', 'Inside interface for NAT', () => change((s) => C.setNatRole(s, deviceId, here(), 'inside')));
    add(['if'], 'ip nat outside', 'Outside interface for NAT', () => change((s) => C.setNatRole(s, deviceId, here(), 'outside')));
    add(['if'], 'no ip nat inside', 'Remove the NAT role', () => change((s) => C.setNatRole(s, deviceId, here(), null)));
    add(['if'], 'no ip nat outside', 'Remove the NAT role', () => change((s) => C.setNatRole(s, deviceId, here(), null)));
    add(['if'], 'nameif {word}', 'Name the interface zone (firewall)', (a) => change((s) => C.setZone(s, deviceId, here(), a.word)));
    add(['if'], 'security-level {num}', 'Security level of the zone, 0 to 100 (firewall)', (a) => change((s) => C.setZone(s, deviceId, here(), undefined, a.num)));
    add(['if'], 'switchport mode access', 'Set trunking mode to ACCESS unconditionally', () => (isSwitch() ? change((s) => C.setSwitchportMode(s, deviceId, here(), 'access')) : invalid(0)));
    add(['if'], 'switchport mode trunk', 'Set trunking mode to TRUNK unconditionally', () => (isSwitch() ? change((s) => C.setSwitchportMode(s, deviceId, here(), 'trunk')) : invalid(0)));
    add(['if'], 'switchport access vlan {num}', 'Set VLAN when interface is in access mode', (a) => (isSwitch() ? change((s) => C.setAccessVlan(s, deviceId, here(), a.num)) : invalid(0)));
    add(['if'], 'switchport trunk allowed vlan {vlans}', 'Set allowed VLANs when interface is in trunking mode', (a) => change((s) => C.setTrunkAllowed(s, deviceId, here(), a.vlans)));
    add(['if'], 'switchport trunk native vlan {num}', 'Set native VLAN when interface is in trunking mode', (a) => change((s) => C.setNativeVlan(s, deviceId, here(), a.num)));
    add(['if'], 'switchport port-security', 'Enable port security', () => (isSwitch() ? change((s) => C.setPortSecurity(s, deviceId, here(), {})) : invalid(0)));
    add(['if'], 'no switchport port-security', 'Disable port security', () => change((s) => C.setPortSecurity(s, deviceId, here(), { enabled: false })));
    add(['if'], 'switchport port-security maximum {num}', 'Max secure addresses', (a) => change((s) => C.setPortSecurity(s, deviceId, here(), { maximum: a.num })));
    add(['if'], 'switchport port-security mac-address sticky', 'Learn the addresses dynamically and keep them', () => change((s) => C.setPortSecurity(s, deviceId, here(), { sticky: true })));
    add(['if'], 'switchport port-security mac-address {mac}', 'Allow this secure MAC address', (a) => change((s) => C.setPortSecurity(s, deviceId, here(), { mac: a.mac })));
    add(['if'], 'switchport port-security violation shutdown', 'Security violation shutdown mode', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'shutdown' })));
    add(['if'], 'switchport port-security violation restrict', 'Security violation restrict mode', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'restrict' })));
    add(['if'], 'switchport port-security violation protect', 'Security violation protect mode', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'protect' })));
    // ACL nommée
    add(['acl'], '{rest}', 'permit | deny <protocol> <source> <destination> [eq <port>]', (a) => {
      const tokens = a.rest.split(' ');
      let seq = null;
      if (/^\d+$/.test(tokens[0])) seq = Number(tokens.shift());
      if (tokens[0] && tokens[0].toLowerCase() === 'no' && /^\d+$/.test(tokens[1] || '')) return change((s) => C.removeAclRule(s, deviceId, state.acl, Number(tokens[1])));
      const rule = parseIosRule(tokens);
      return rule ? change((s) => C.addAclRule(s, deviceId, state.acl, rule, seq)) : invalid(0);
    });
    add(['config', 'if', 'acl', 'vlan'], 'exit', 'Exit from the current mode', () => { state.mode = state.mode === 'config' ? 'priv' : 'config'; state.iface = null; state.acl = null; return ok(); });
    add(['config', 'if', 'acl', 'vlan'], 'end', 'Exit to privileged mode', () => { state.mode = 'priv'; state.iface = null; return ok(); });
    add(['user', 'priv'], 'exit', 'Exit the session', () => { state.mode = 'user'; return ok(['', `${name()} con0 is now available`, '', 'Press RETURN to get started.']); });
  } else {
    // ---------------- style vrp
    add(['user'], 'system-view', 'Enter the system view', () => { state.mode = 'config'; return ok(['Enter system view, return user view with return command.']); });
    add(['user', 'config'], 'save', 'Save the current configuration', () => ok(['The current configuration will be written to the device. Continue? [Y/N]:y', 'Info: Save the configuration successfully.']));
    add(['config'], 'sysname {word}', 'Set the host name', (a) => change((s) => C.setHostname(s, deviceId, a.word)));
    add(['config', 'if', 'acl', 'vlan'], 'interface {iface}', 'Specify an interface', (a) => enterInterface(a.iface));
    add(['config'], 'undo interface {iface}', 'Delete a sub-interface', (a) => (a.iface.includes('.') ? change((s) => C.removeSubinterface(s, deviceId, a.iface)) : invalid(5)));
    add(['config'], 'ip route-static {ip} {mask} {ip2}', 'Configure a static route', (a) => (isL3() ? change((s) => C.addRoute(s, deviceId, a.ip, a.mask, a.ip2)) : invalid(0)));
    add(['config'], 'undo ip route-static {ip} {mask} {ip2}', 'Delete a static route', (a) => change((s) => C.removeRoute(s, deviceId, a.ip, a.mask, a.ip2)));
    add(['config', 'acl'], 'acl name {word} advance', 'Advanced ACL (by name)', (a) => {
      if (!isL3()) return invalid(0);
      const r = change((s) => C.ensureAcl(s, deviceId, a.word));
      if (!r.error) { state.mode = 'acl'; state.acl = a.word; }
      return r;
    });
    add(['config', 'acl'], 'acl number {num}', 'Advanced ACL (3000 to 3999)', (a) => {
      if (!isL3()) return invalid(0);
      const r = change((s) => C.ensureAcl(s, deviceId, String(a.num)));
      if (!r.error) { state.mode = 'acl'; state.acl = String(a.num); }
      return r;
    });
    add(['config'], 'undo acl name {word}', 'Delete an ACL', (a) => change((s) => C.removeAcl(s, deviceId, a.word)));
    add(['acl'], 'rule {rest}', '[id] permit | deny <protocol> [source <addr> <wildcard>] [destination <addr> <wildcard>] [destination-port eq <port>]', (a) => {
      const parsed = parseVrpRule(a.rest.split(' '));
      return parsed ? change((s) => C.addAclRule(s, deviceId, state.acl, parsed.rule, parsed.seq)) : incomplete();
    });
    add(['acl'], 'undo rule {num}', 'Delete a rule', (a) => change((s) => C.removeAclRule(s, deviceId, state.acl, a.num * 2)));
    add(['config', 'vlan'], 'vlan {num}', 'Create a VLAN and enter its view', (a) => {
      if (!isSwitch()) return invalid(0);
      const r = change((s) => C.addVlan(s, deviceId, a.num));
      if (!r.error) { state.mode = 'vlan'; state.vlan = a.num; }
      return r;
    });
    add(['config'], 'vlan batch {vlans}', 'Create several VLANs', (a) => (isSwitch() ? change((s) => a.vlans.reduce((acc, v) => C.addVlan(acc, deviceId, v), s)) : invalid(0)));
    add(['config'], 'undo vlan {num}', 'Delete a VLAN', (a) => change((s) => C.removeVlan(s, deviceId, a.num)));
    add(['vlan'], 'description {rest}', 'VLAN description', (a) => change((s) => C.addVlan(s, deviceId, state.vlan, a.rest.replace(/\s+/g, '_'))));
    add(['if'], 'ip address {ip} {mask}', 'Configure an IP address', (a) => (isL3() ? change((s) => B.setAddress(s, deviceId, here(), a.ip, a.mask)) : fail('Error: This interface is a Layer 2 port. Use a router or a firewall.')));
    add(['if'], 'undo ip address', 'Delete the IP address', () => change((s) => B.setAddress(s, deviceId, here(), null)));
    add(['if'], 'shutdown', 'Shut down the interface', () => change((s) => C.setShutdown(s, deviceId, here(), true)));
    add(['if'], 'undo shutdown', 'Bring the interface up', () => change((s) => C.setShutdown(s, deviceId, here(), false), [`Info: Interface ${displayName('vrp', here())} is undergoing UP.`]));
    add(['if'], 'description {rest}', 'Interface description', (a) => change((s) => C.setDescription(s, deviceId, here(), a.rest)));
    add(['if'], 'dot1q termination vid {num}', '802.1Q sub-interface VLAN', (a) => change((s) => C.setSubinterfaceVlan(s, deviceId, here(), a.num)));
    add(['if'], 'traffic-filter inbound acl name {word}', 'Filter incoming packets', (a) => change((s) => C.bindAcl(s, deviceId, here(), 'in', a.word)));
    add(['if'], 'traffic-filter outbound acl name {word}', 'Filter outgoing packets', (a) => change((s) => C.bindAcl(s, deviceId, here(), 'out', a.word)));
    add(['if'], 'traffic-filter inbound acl {num}', 'Filter incoming packets', (a) => change((s) => C.bindAcl(s, deviceId, here(), 'in', String(a.num))));
    add(['if'], 'undo traffic-filter inbound', 'Remove the inbound filter', () => change((s) => C.bindAcl(s, deviceId, here(), 'in', null)));
    add(['if'], 'undo traffic-filter outbound', 'Remove the outbound filter', () => change((s) => C.bindAcl(s, deviceId, here(), 'out', null)));
    add(['if'], 'nat outbound', 'Translate sources leaving this interface (PAT)', () => change((s) => C.setNatRole(C.addNatRule(s, deviceId, { type: 'overload' }), deviceId, here(), 'outside')));
    add(['if'], 'nat outbound {word}', 'PAT for sources matching an ACL', (a) => change((s) => C.setNatRole(C.addNatRule(s, deviceId, { type: 'overload', acl: a.word }), deviceId, here(), 'outside')));
    add(['if'], 'nat static global {ip} inside {ip2}', 'Static translation', (a) => change((s) => C.setNatRole(C.addNatRule(s, deviceId, { type: 'static', outside: a.ip, inside: a.ip2 }), deviceId, here(), 'outside')));
    add(['if'], 'undo nat outbound', 'Remove PAT', () => change((s) => C.removeNatRule(s, deviceId, { type: 'overload' })));
    add(['if'], 'nat inside', 'Mark as NAT inside (internal network side)', () => change((s) => C.setNatRole(s, deviceId, here(), 'inside')));
    add(['if'], 'port link-type access', 'Access port', () => (isSwitch() ? change((s) => C.setSwitchportMode(s, deviceId, here(), 'access')) : invalid(0)));
    add(['if'], 'port link-type trunk', 'Trunk port', () => (isSwitch() ? change((s) => C.setSwitchportMode(s, deviceId, here(), 'trunk')) : invalid(0)));
    add(['if'], 'port default vlan {num}', 'VLAN of an access port', (a) => (isSwitch() ? change((s) => C.setAccessVlan(s, deviceId, here(), a.num)) : invalid(0)));
    add(['if'], 'port trunk allow-pass vlan {vlans}', 'VLANs carried by the trunk', (a) => change((s) => C.setTrunkAllowed(s, deviceId, here(), a.vlans)));
    add(['if'], 'port trunk allow-pass vlan all', 'All VLANs on the trunk', () => change((s) => C.setTrunkAllowed(s, deviceId, here(), null)));
    add(['if'], 'port trunk pvid vlan {num}', 'Native VLAN of the trunk', (a) => change((s) => C.setNativeVlan(s, deviceId, here(), a.num)));
    add(['if'], 'port-security enable', 'Enable port security', () => (isSwitch() ? change((s) => C.setPortSecurity(s, deviceId, here(), {})) : invalid(0)));
    add(['if'], 'undo port-security enable', 'Disable port security', () => change((s) => C.setPortSecurity(s, deviceId, here(), { enabled: false })));
    add(['if'], 'port-security max-mac-num {num}', 'Max secure addresses', (a) => change((s) => C.setPortSecurity(s, deviceId, here(), { maximum: a.num })));
    add(['if'], 'port-security mac-address sticky', 'Sticky learning', () => change((s) => C.setPortSecurity(s, deviceId, here(), { sticky: true })));
    add(['if'], 'port-security mac-address {mac} vlan {num}', 'Static secure MAC address', (a) => change((s) => C.setPortSecurity(s, deviceId, here(), { mac: a.mac })));
    add(['if'], 'port-security protect-action error-down', 'Shut the port on violation', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'shutdown' })));
    add(['if'], 'port-security protect-action restrict', 'Drop and count on violation', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'restrict' })));
    add(['if'], 'port-security protect-action protect', 'Drop silently on violation', () => change((s) => C.setPortSecurity(s, deviceId, here(), { violation: 'protect' })));
    add(['if'], 'firewall zone {word}', 'Add the interface to a zone (firewall)', (a) => change((s) => C.setZone(s, deviceId, here(), a.word)));
    add(['config', 'if', 'acl', 'vlan'], 'quit', 'Exit from the current view', () => { state.mode = state.mode === 'config' ? 'user' : 'config'; state.iface = null; state.acl = null; return ok(); });
    add(['config', 'if', 'acl', 'vlan'], 'return', 'Return to the user view', () => { state.mode = 'user'; state.iface = null; return ok(); });
  }

  function enterInterface(iface) {
    let r = ok();
    if (iface.includes('.') && !(def().interfaces || []).some((i) => i.name === iface)) r = change((s) => C.ensureSubinterface(s, deviceId, iface));
    if (!r.error) { state.mode = 'if'; state.iface = iface; state.acl = null; }
    return r;
  }

  // ---------- analyse d'une ligne
  const ARG = {
    ip: (t) => isIp(t),
    ip2: (t) => isIp(t),
    mask: (t) => C.prefixOf(t) != null,
    num: (t) => /^\d+$/.test(t),
    word: (t) => /^[\w.-]+$/.test(t),
    mac: (t) => C.normalizeMac(t) != null,
    target: (t) => /^\S+$/.test(t),
    vlans: (t) => { try { C.vlanList(t); return true; } catch { return false; } },
    iface: (t) => resolveIface(dialect, def(), t, { allowSub: isL3() }) != null,
  };
  const convert = (kind, t) => {
    if (kind === 'mask') return C.prefixOf(t);
    if (kind === 'num') return Number(t);
    if (kind === 'vlans') return C.vlanList(t);
    if (kind === 'iface') return resolveIface(dialect, def(), t, { allowSub: isL3() });
    return t;
  };

  /** Regroupe « GigabitEthernet 0/1 » en un seul mot quand le nom est coupé par une espace. */
  function joinIfaceTokens(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      if (/^[a-zA-Z-]+$/.test(tokens[i]) && /^\d[\d/.]*$/.test(tokens[i + 1] || '') && /ethernet|^gi|^ge|^te|^xg|^fa|^eth/i.test(tokens[i])) {
        out.push(tokens[i] + tokens[i + 1]);
        i++;
      } else out.push(tokens[i]);
    }
    return out;
  }

  /** Correspondance d'une ligne avec une entrée : { args, score } ou { at, reason }. */
  function matchEntry(entry, tokens) {
    const args = {};
    let i = 0;
    let exact = 0;
    for (const [w, word] of entry.words.entries()) {
      const placeholder = /^\{(\w+)\}$/.exec(word);
      if (placeholder) {
        const kind = placeholder[1];
        if (kind === 'rest') {
          if (i >= tokens.length) return { at: i, reason: 'incomplete' };
          args.rest = tokens.slice(i).join(' ');
          return { args, score: exact };
        }
        if (i >= tokens.length) return { at: i, reason: 'incomplete' };
        // Une liste de VLAN en fin de commande peut s'écrire en plusieurs mots :
        // « 10 20 », « 10,20 », « 10 to 20 » (vrp), « 30-32 ».
        if (kind === 'vlans' && w === entry.words.length - 1) {
          const text = tokens.slice(i).join(' ').replace(/\s+to\s+/gi, '-').replace(/\s+/g, ',');
          if (!ARG.vlans(text)) return { at: i, reason: 'invalid' };
          args.vlans = convert('vlans', text);
          return { args, score: exact };
        }
        if (!ARG[kind](tokens[i])) return { at: i, reason: 'invalid' };
        args[kind] = convert(kind, tokens[i]);
        i++;
      } else {
        if (i >= tokens.length) return { at: i, reason: 'incomplete', next: word };
        const token = tokens[i].toLowerCase();
        if (!word.startsWith(token)) return { at: i, reason: 'invalid' };
        if (word === token) exact++;
        i++;
      }
    }
    if (i < tokens.length) return { at: i, reason: 'invalid' };
    return { args, score: exact };
  }

  function candidates() {
    return entries.filter((entry) => entry.modes.includes(state.mode));
  }

  function run(line) {
    const trimmed = line.trim();
    if (!trimmed) return ok();
    if (dialect === 'pc') return pcCommand(trimmed.split(/\s+/), trimmed);
    let tokens = joinIfaceTokens(trimmed.split(/\s+/));
    // « do show … » depuis la configuration (style ios)
    if (dialect === 'ios' && ['config', 'if', 'acl', 'vlan'].includes(state.mode) && 'do'.startsWith(tokens[0].toLowerCase()) && tokens[0].length >= 2 && tokens.length > 1) {
      const saved = state.mode;
      state.mode = 'priv';
      const result = run(tokens.slice(1).join(' '));
      if (['priv', 'user'].includes(state.mode)) state.mode = saved;
      return result;
    }
    const pool = candidates();
    const results = pool.map((entry) => ({ entry, match: matchEntry(entry, tokens) }));
    const good = results.filter((r) => r.match.args);
    if (good.length) {
      // Abréviation ambiguë : deux commandes complètes différentes conviennent.
      const literalsOf = (entry) => entry.words.filter((w) => !w.startsWith('{')).join(' ');
      const best = good.sort((a, b) => b.match.score - a.match.score || literalsOf(b.entry).length - literalsOf(a.entry).length);
      const top = best.filter((r) => r.match.score === best[0].match.score);
      const distinct = new Set(top.map((r) => literalsOf(r.entry)));
      const ambiguousWords = tokens.some((t, i) => {
        const words = new Set(top.map((r) => r.entry.words[i]).filter((w) => w && !w.startsWith('{')));
        return words.size > 1 && ![...words].includes(t.toLowerCase());
      });
      if (distinct.size > 1 && ambiguousWords && top[0].entry.words[0] !== '{rest}') {
        return fail(dialect === 'vrp' ? 'Error: Ambiguous command found at \'^\' position.' : `% Ambiguous command:  "${trimmed}"`);
      }
      return best[0].entry.run(best[0].match.args);
    }
    // Abréviation ambiguë (« c » : configure, copy, clear…) : on le dit, comme le vrai matériel.
    let alive = pool;
    for (const [i, token] of tokens.entries()) {
      const lower = token.toLowerCase();
      const words = new Set(alive.map((e) => e.words[i]).filter((w) => w && !w.startsWith('{') && w.startsWith(lower)));
      if (words.size > 1 && !words.has(lower)) return fail(dialect === 'vrp' ? 'Error: Ambiguous command found at \'^\' position.' : `% Ambiguous command:  "${trimmed}"`);
      alive = alive.filter((e) => e.words[i] && (e.words[i].startsWith('{') || e.words[i].startsWith(lower)));
      if (!alive.length) break;
    }
    const furthest = results.reduce((acc, r) => (r.match.at > acc.at || (r.match.at === acc.at && r.match.reason === 'incomplete') ? r.match : acc), { at: -1 });
    if (furthest.reason === 'incomplete' && furthest.at >= tokens.length) return incomplete();
    const offset = tokens.slice(0, Math.max(0, furthest.at)).reduce((sum, t) => sum + t.length + 1, 0);
    return invalid(offset);
  }

  /** Mots possibles à la position suivante (aide « ? »). */
  function help(line) {
    if (dialect === 'pc') return run('help').lines;
    const endsWithSpace = /\s$/.test(line) || line === '';
    const tokens = joinIfaceTokens(line.trim().split(/\s+/).filter(Boolean));
    const done = endsWithSpace ? tokens : tokens.slice(0, -1);
    const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] || '').toLowerCase();
    const options = new Map();
    for (const entry of candidates()) {
      const m = matchEntry({ ...entry, words: entry.words.slice(0, done.length) }, done);
      if (!m.args && !(done.length === 0)) continue;
      const word = entry.words[done.length];
      if (!word) { options.set('<cr>', ''); continue; }
      const label = word.startsWith('{') ? `<${word.slice(1, -1)}>` : word;
      if (!word.startsWith('{') && !word.startsWith(partial)) continue;
      if (!options.has(label) || !options.get(label)) options.set(label, entry.words.length === done.length + 1 ? entry.help : (KEYWORDS[word] || ''));
    }
    return [...options.entries()].sort().map(([word, text]) => `  ${pad(word, 22)} ${text}`);
  }

  /** Complète le dernier mot (Tab) si une seule possibilité. */
  function complete(line) {
    if (dialect === 'pc') return line;
    const tokens = line.split(/\s+/);
    const last = tokens.pop();
    if (!last) return line;
    const done = tokens.filter(Boolean);
    const words = new Set();
    for (const entry of candidates()) {
      const m = matchEntry({ ...entry, words: entry.words.slice(0, done.length) }, done);
      if (!m.args && done.length) continue;
      const word = entry.words[done.length];
      if (word && !word.startsWith('{') && word.startsWith(last.toLowerCase())) words.add(word);
    }
    if (words.size !== 1) return line;
    return [...done, [...words][0]].join(' ') + ' ';
  }

  return {
    dialect,
    system,
    get mode() { return state.mode; },
    prompt,
    banner() {
      if (dialect === 'pc') return ['Microsoft Windows [Version 10.0]', '(c) Bureau virtuel du laboratoire. Tapez « help ».', ''];
      const model = modelOf(def());
      return [`${system.name} — ${model ? model.name : def().type}`, dialect === 'vrp' ? 'Info: The max number of VTY users is 5.' : 'Press RETURN to get started.', ''];
    },
    /** Exécute une ligne ; retourne { lines, scenario?, run?, error?, clear? }. */
    execute(line) {
      if (line.trim()) state.history.push(line);
      if (/\?$/.test(line.trim()) && dialect !== 'pc') return { lines: help(line.trim().slice(0, -1)) };
      try {
        return run(line);
      } catch (error) {
        return fail(dialect === 'vrp' ? `Error: ${err(error)}` : `% ${err(error)}`);
      }
    },
    help,
    complete,
    history: () => [...state.history],
  };
}

function wrapText(text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text || '').split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { lines.push(line.trim()); line = word; } else line += ' ' + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/**
 * Texte du résultat d'un ping ou d'un traceroute lancé depuis une console, d'après les
 * évènements de la simulation (réponses reçues par l'équipement source).
 * @param {Object} run   { kind, target, count }
 * @param {Array} replies  [{ type: 'reply' | 'ttl' | 'unreachable' | 'timeout', from, ttl? }]
 */
export function formatRun(dialect, run, replies) {
  if (run.kind === 'ping') {
    const ok = replies.filter((r) => r.type === 'reply').length;
    const total = run.count || 1;
    if (dialect === 'pc') {
      const lines = replies.slice(0, total).map((r) => (r.type === 'reply' ? `Reply from ${r.from}: bytes=32 time<1ms TTL=${r.ttl || 64}` : r.type === 'unreachable' ? `Reply from ${r.from}: Destination host unreachable.` : 'Request timed out.'));
      while (lines.length < total) lines.push('Request timed out.');
      return [...lines, '', `Ping statistics for ${run.target}:`, `    Packets: Sent = ${total}, Received = ${ok}, Lost = ${total - ok} (${Math.round(((total - ok) / total) * 100)}% loss),`];
    }
    if (dialect === 'vrp') {
      const lines = replies.slice(0, total).map((r, i) => (r.type === 'reply' ? `    Reply from ${run.target}: bytes=56 Sequence=${i + 1} ttl=${r.ttl || 255} time=1 ms` : `    Request time out`));
      while (lines.length < total) lines.push('    Request time out');
      return [...lines, '', `  --- ${run.target} ping statistics ---`, `    ${total} packet(s) transmitted`, `    ${ok} packet(s) received`, `    ${(((total - ok) / total) * 100).toFixed(2)}% packet loss`];
    }
    const marks = replies.slice(0, total).map((r) => (r.type === 'reply' ? '!' : r.type === 'unreachable' ? 'U' : '.')).join('').padEnd(total, '.');
    return [marks, `Success rate is ${Math.round((ok / total) * 100)} percent (${ok}/${total})${ok ? ', round-trip min/avg/max = 1/1/2 ms' : ''}`];
  }
  if (run.kind === 'trace') {
    const lines = [];
    for (const [i, r] of replies.entries()) {
      const hop = i + 1;
      const who = r.type === 'timeout' ? (dialect === 'pc' ? '  *        *        *     Request timed out.' : '* * *') : r.from;
      if (dialect === 'pc') lines.push(`  ${hop}    <1 ms    <1 ms    <1 ms  ${who}`.replace('  *        *        *     Request timed out.', '').trimEnd() || `  ${hop}     *        *        *     Request timed out.`);
      else lines.push(`  ${hop} ${who}${r.type === 'timeout' ? '' : ' 1 msec 1 msec 1 msec'}`);
      if (r.type === 'reply' || r.type === 'unreachable') break;
    }
    if (dialect === 'pc') lines.push('', 'Trace complete.');
    return lines;
  }
  return [];
}
