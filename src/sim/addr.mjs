// Outils d'adressage partagés par toute la simulation (MAC, IPv4, sous-réseaux).
// Fichier sans dépendance : utilisable dans le navigateur comme dans les tests Node.

export const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';
export const BROADCAST_IP = '255.255.255.255';
export const UNSPECIFIED_IP = '0.0.0.0';

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Adresse MAC « de base » d'un équipement (celle de son châssis, affichée par « show version » et
 * au-dessus d'un switch) : `def.mac` si le scénario la donne, sinon une adresse administrée
 * localement (02:…) dérivée de son identifiant, donc toujours la même pour le même équipement.
 */
export function baseMac(def) {
  if (def && isMac(def.mac)) return normalizeMac(def.mac);
  let hash = 2166136261; // FNV-1a 32 bits sur l'identifiant
  for (const ch of String((def && def.id) || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const bytes = [0x02, 0x00, (hash >>> 24) & 0xff, (hash >>> 16) & 0xff, (hash >>> 8) & 0xff, hash & 0xff];
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
}

/** Vrai si `value` est une adresse MAC écrite AA:BB:CC:DD:EE:FF. */
export function isMac(value) {
  return typeof value === 'string' && MAC_RE.test(value);
}

/** Vrai si `value` est une adresse IPv4 valide (quatre octets entre 0 et 255). */
export function isIp(value) {
  if (typeof value !== 'string') return false;
  const m = value.match(IP_RE);
  return !!m && m.slice(1).every((part) => Number(part) <= 255);
}

/** Les adresses MAC sont comparées en majuscules partout dans la simulation. */
export function normalizeMac(mac) {
  return String(mac).toUpperCase();
}

export function isBroadcastMac(mac) {
  return normalizeMac(mac) === BROADCAST_MAC;
}

/** Bit « groupe » du premier octet : trame de diffusion ou de multidiffusion. */
export function isGroupMac(mac) {
  return (parseInt(String(mac).slice(0, 2), 16) & 1) === 1;
}

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

export function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** Masque (entier) correspondant à une longueur de préfixe, ex. 24 -> 255.255.255.0. */
export function maskOf(prefix) {
  return prefix === 0 ? 0 : (2 ** 32 - 2 ** (32 - prefix));
}

export function maskToString(prefix) {
  return intToIp(maskOf(prefix));
}

/** Adresse du réseau auquel appartient `ip` pour un préfixe donné. */
export function networkOf(ip, prefix) {
  const size = 2 ** (32 - prefix);
  return intToIp(Math.floor(ipToInt(ip) / size) * size);
}

/** Adresse de diffusion dirigée du réseau de `ip`. */
export function broadcastOf(ip, prefix) {
  const size = 2 ** (32 - prefix);
  return intToIp(Math.floor(ipToInt(ip) / size) * size + size - 1);
}

/** Vrai si `ip` appartient au réseau `network`/`prefix`. */
export function inNetwork(ip, network, prefix) {
  return networkOf(ip, prefix) === networkOf(network, prefix);
}
