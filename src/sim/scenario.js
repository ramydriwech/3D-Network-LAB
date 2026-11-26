// CONTRAT COMMUN — format des fichiers de scénario (voir docs/format-scenario.md).
// Ce module valide un scénario JSON et le charge depuis une URL.

import { isIp, isMac } from './addr.js';
import { CABLES, ETHERNET_SPEEDS, MODELS } from './catalog.js';
import { checkRule } from './security.js';

export const SCENARIO_FORMAT = 1;
export const DEVICE_TYPES = Object.freeze(['host', 'server', 'switch', 'router', 'firewall']);

const isText = (value) => !!value && typeof value.fr === 'string' && typeof value.en === 'string';

/** Découpe « pc1:eth0 » en { device: 'pc1', iface: 'eth0' }. */
export function parseEndpoint(text) {
  const [device, iface] = String(text).split(':');
  return { device, iface };
}

/**
 * Vérifie un scénario. Retourne { ok, errors } ; `errors` liste tout ce qui ne respecte
 * pas le format, avec le chemin de l'élément fautif.
 */
export function validateScenario(scenario) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!scenario || typeof scenario !== 'object') return { ok: false, errors: ['le scénario doit être un objet JSON'] };

  if (scenario.format !== SCENARIO_FORMAT) fail(`format : attendu ${SCENARIO_FORMAT}`);
  if (!scenario.id || !/^[a-z0-9-]+$/.test(scenario.id)) fail('id : minuscules, chiffres et tirets uniquement');
  if (!isText(scenario.title)) fail('title : il faut { fr, en }');
  if (!isText(scenario.summary)) fail('summary : il faut { fr, en }');
  if (!Array.isArray(scenario.protocols)) fail('protocols : liste attendue');

  const devices = new Map();
  const macs = new Set();
  // Une liste vide est permise : c'est le point de départ d'un réseau construit dans l'éditeur.
  if (!Array.isArray(scenario.devices)) fail('devices : liste d\'équipements attendue');
  for (const [i, device] of (scenario.devices || []).entries()) {
    const where = `devices[${i}]`;
    if (!device.id) { fail(`${where}.id manquant`); continue; }
    if (devices.has(device.id)) fail(`${where}.id « ${device.id} » en double`);
    devices.set(device.id, device);
    if (!DEVICE_TYPES.includes(device.type)) fail(`${where}.type inconnu « ${device.type} »`);
    if (!device.name) fail(`${where}.name manquant`);
    if (!Array.isArray(device.position) || device.position.length !== 3 || device.position.some((n) => typeof n !== 'number')) {
      fail(`${where}.position : [x, y, z] attendu`);
    }
    for (const [j, iface] of (device.interfaces || []).entries()) {
      const at = `${where}.interfaces[${j}]`;
      if (!iface.name) fail(`${at}.name manquant`);
      // Une sous-interface (« g0/0.10 ») partage l'adresse MAC de son interface physique.
      const subif = iface.name && iface.name.includes('.');
      if (subif) {
        const parent = iface.name.split('.')[0];
        if (!(device.interfaces || []).some((other) => other.name === parent)) fail(`${at} : interface physique « ${parent} » absente`);
        // Sans VLAN, la sous-interface existe mais ne reçoit rien (comme avant « encapsulation dot1Q »).
        if (iface.vlan != null && (!Number.isInteger(iface.vlan) || iface.vlan < 1 || iface.vlan > 4094)) fail(`${at}.vlan : numéro de 1 à 4094`);
        if (iface.ip != null && (!isIp(iface.ip) || !Number.isInteger(iface.prefix) || iface.prefix < 1 || iface.prefix > 30)) fail(`${at} : ip et prefix attendus`);
      }
      if (iface.nat != null && !['inside', 'outside'].includes(iface.nat)) fail(`${at}.nat : inside ou outside`);
      if (iface.acl != null) {
        for (const dir of ['in', 'out']) {
          if (iface.acl[dir] != null && !(device.acls && device.acls[iface.acl[dir]])) fail(`${at}.acl.${dir} : liste « ${iface.acl[dir]} » absente de acls`);
        }
      }
      if (iface.zone != null && typeof iface.zone !== 'string') fail(`${at}.zone : texte attendu`);
      if (device.type !== 'switch' && !subif) {
        if (!isMac(iface.mac)) fail(`${at}.mac invalide`);
        else if (macs.has(iface.mac.toUpperCase())) fail(`${at}.mac « ${iface.mac} » en double`);
        else macs.add(iface.mac.toUpperCase());
        if (iface.ip != null) {
          if (!isIp(iface.ip)) fail(`${at}.ip invalide`);
          if (!Number.isInteger(iface.prefix) || iface.prefix < 1 || iface.prefix > 30) fail(`${at}.prefix : entier de 1 à 30`);
        }
      }
    }
    if (device.type !== 'switch' && !(device.interfaces || []).length) fail(`${where}.interfaces : au moins une interface`);
    if (device.gateway != null && !isIp(device.gateway)) fail(`${where}.gateway invalide`);
    if (device.model != null) {
      if (!MODELS[device.model]) fail(`${where}.model : modèle « ${device.model} » absent du catalogue`);
      else if (MODELS[device.model].type !== device.type) fail(`${where}.model : « ${device.model} » n'est pas un modèle de ${device.type}`);
    }
    for (const [j, iface] of (device.interfaces || []).entries()) {
      if (iface.speed != null && !ETHERNET_SPEEDS.includes(iface.speed)) {
        fail(`${where}.interfaces[${j}].speed : ${ETHERNET_SPEEDS.join(', ')} (Mb/s)`);
      }
    }
    for (const [j, route] of (device.routes || []).entries()) {
      if (!isIp(route.network) || !Number.isInteger(route.prefix) || !isIp(route.via)) {
        fail(`${where}.routes[${j}] : { network, prefix, via } attendu`);
      }
    }
    // Laboratoire : listes d'accès, NAT, VLAN et réglages des ports de switch.
    for (const [name, rules] of Object.entries(device.acls || {})) {
      if (!Array.isArray(rules)) { fail(`${where}.acls.${name} : liste de règles attendue`); continue; }
      rules.forEach((rule, j) => { const problem = checkRule(rule); if (problem) fail(`${where}.acls.${name}[${j}] : ${problem}`); });
    }
    for (const [j, rule] of (device.nat || []).entries()) {
      if (rule.type === 'static') {
        if (!isIp(rule.inside) || !isIp(rule.outside)) fail(`${where}.nat[${j}] : inside et outside (adresses) attendus`);
      } else if (rule.type === 'overload') {
        if (rule.acl != null && !(device.acls && device.acls[rule.acl])) fail(`${where}.nat[${j}].acl : liste « ${rule.acl} » absente`);
      } else fail(`${where}.nat[${j}].type : static ou overload`);
    }
    for (const id of Object.keys(device.vlans || {})) {
      if (!(Number(id) >= 1 && Number(id) <= 4094)) fail(`${where}.vlans : numéro « ${id} » hors de 1 à 4094`);
    }
    for (const [port, config] of Object.entries(device.ports || {})) {
      const at = `${where}.ports.${port}`;
      if (config.mode != null && !['access', 'trunk'].includes(config.mode)) fail(`${at}.mode : access ou trunk`);
      if (config.vlan != null && !(Number.isInteger(config.vlan) && config.vlan >= 1 && config.vlan <= 4094)) fail(`${at}.vlan : 1 à 4094`);
      if (config.allowed != null && !(Array.isArray(config.allowed) && config.allowed.every((v) => Number.isInteger(v)))) fail(`${at}.allowed : liste de VLAN`);
      if (config.security != null) {
        const sec = config.security;
        if (sec.violation != null && !['shutdown', 'restrict', 'protect'].includes(sec.violation)) fail(`${at}.security.violation : shutdown, restrict ou protect`);
        if (sec.macs != null && !(Array.isArray(sec.macs) && sec.macs.every(isMac))) fail(`${at}.security.macs : adresses MAC attendues`);
      }
    }
  }

  const linkIds = new Set();
  const usedPorts = new Set();
  for (const [i, link] of (scenario.links || []).entries()) {
    const where = `links[${i}]`;
    if (!link.id) fail(`${where}.id manquant`);
    if (linkIds.has(link.id)) fail(`${where}.id « ${link.id} » en double`);
    linkIds.add(link.id);
    for (const side of ['a', 'b']) {
      const end = parseEndpoint(link[side]);
      const device = devices.get(end.device);
      if (!device) { fail(`${where}.${side} : équipement « ${end.device} » inconnu`); continue; }
      if (!end.iface) { fail(`${where}.${side} : écrire « equipement:interface »`); continue; }
      if (device.type !== 'switch' && !(device.interfaces || []).some((it) => it.name === end.iface)) {
        fail(`${where}.${side} : interface « ${end.iface} » absente de ${end.device}`);
      }
      if (usedPorts.has(link[side])) fail(`${where}.${side} : « ${link[side]} » est déjà câblé`);
      usedPorts.add(link[side]);
    }
    if (link.cable != null && !CABLES[link.cable]) fail(`${where}.cable : câble « ${link.cable} » inconnu (${Object.keys(CABLES).join(', ')})`);
    if (link.length != null && !(typeof link.length === 'number' && link.length > 0)) fail(`${where}.length : longueur en mètres attendue`);
    if (parseEndpoint(link.a).device === parseEndpoint(link.b).device) fail(`${where} : un câble doit relier deux équipements différents`);
  }

  if (!Array.isArray(scenario.steps)) fail('steps : liste attendue (elle peut être vide)');
  // Une étape « group » contient des étapes jouées en même temps : on les vérifie aussi.
  const allSteps = [];
  for (const [i, step] of (scenario.steps || []).entries()) {
    allSteps.push([`steps[${i}]`, step]);
    for (const [j, inner] of (step.action === 'group' ? step.steps || [] : []).entries()) allSteps.push([`steps[${i}].steps[${j}]`, inner]);
    if (step.action === 'group' && !(Array.isArray(step.steps) && step.steps.length)) fail(`steps[${i}].steps : liste d'étapes attendue`);
  }
  for (const [where, step] of allSteps) {
    if (step.size != null && !(Number.isInteger(step.size) && step.size > 0)) fail(`${where}.size : nombre d'octets attendu`);
    if (step.lose != null && !(Array.isArray(step.lose) && step.lose.every((n) => Number.isInteger(n) && n >= 0))) {
      fail(`${where}.lose : liste de numéros de segments (à partir de 0)`);
    }
    if (!step.action) fail(`${where}.action manquante`);
    if (step.from && !devices.has(step.from)) fail(`${where}.from : équipement « ${step.from} » inconnu`);
    if (step.title && !isText(step.title)) fail(`${where}.title : il faut { fr, en }`);
    if (step.explanation && !isText(step.explanation)) fail(`${where}.explanation : il faut { fr, en }`);
    for (const id of step.path || []) {
      if (!devices.has(id)) fail(`${where}.path : équipement « ${id} » inconnu`);
    }
  }

  for (const [key, text] of Object.entries(scenario.explanations || {})) {
    if (!isText(text)) fail(`explanations["${key}"] : il faut { fr, en }`);
  }
  return { ok: errors.length === 0, errors };
}

/** Charge et valide un scénario. `fetchImpl` permet de tester sans réseau. */
export async function fetchScenario(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Scénario introuvable : ${url} (HTTP ${response.status})`);
  const scenario = await response.json();
  const { ok, errors } = validateScenario(scenario);
  if (!ok) throw new Error(`Scénario invalide (${url}) :\n- ` + errors.join('\n- '));
  return scenario;
}
