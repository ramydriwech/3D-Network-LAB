// HTTP — HyperText Transfer Protocol : le navigateur demande une page à un serveur web.
//
// Enchaînement simulé pour l'URL http://www.supcom.tn/ :
//   1. DNS  : trouver l'adresse IP du nom (sauf si l'URL contient déjà une adresse) ;
//   2. TCP  : ouvrir une connexion vers le port 80 du serveur ;
//   3. HTTP : envoyer « GET / » et recevoir « 200 OK » avec la page ;
//   4. TCP  : fermer la connexion.
//
// Simplifications pédagogiques : une seule requête par connexion, en-têtes réduits à
// l'essentiel, page transportée dans un seul segment. HTTPS ajouterait, entre les étapes
// 2 et 3, un échange TLS qui chiffre tout ce qui suit ; il n'est pas simulé ici.

import { note } from '../events.js';
import { isIp } from '../addr.js';

export const HTTP_PORT = 80;
const REASONS = { 200: 'OK', 404: 'Not Found' };

const texts = {
  'http.start': {
    fr: '{name} veut afficher {url}. Il lui faut d\'abord l\'adresse IP de « {host} », puis une connexion TCP vers le port {port}.',
    en: '{name} wants to display {url}. It first needs the IP address of "{host}", then a TCP connection to port {port}.',
  },
  'http.request': {
    fr: '{name} envoie sa requête HTTP dans la connexion TCP : « GET {path} » pour l\'hôte {host}.',
    en: '{name} sends its HTTP request over the TCP connection: "GET {path}" for host {host}.',
  },
  'http.response': {
    fr: '{name} répond « {status} {reason} » avec le contenu de la page ({len} octets). Ce segment acquitte aussi la requête.',
    en: '{name} answers "{status} {reason}" with the page content ({len} bytes). This segment also acknowledges the request.',
  },
  'http.rendered': {
    fr: '{name} a reçu la réponse {status} : la page « {title} » peut être affichée. Il ferme maintenant la connexion.',
    en: '{name} received response {status}: the page "{title}" can be displayed. It now closes the connection.',
  },
  'http.dnsFailed': {
    fr: '{name} ne peut pas charger la page : le nom « {host} » est introuvable.',
    en: '{name} cannot load the page: the name "{host}" cannot be found.',
  },
};

/** Découpe « http://hote:port/chemin » sans dépendre de l'objet URL du navigateur. */
export function parseUrl(url) {
  const match = String(url).match(/^(?:http:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/);
  if (!match) return null;
  return { host: match[1], port: match[2] ? Number(match[2]) : HTTP_PORT, path: match[3] || '/' };
}

/** Côté serveur : fabrique la réponse à une requête GET. */
function respond(device, pages, packet) {
  const request = packet.http;
  const page = pages[request.path];
  const status = page ? 200 : 404;
  const body = page ? page.body : '<h1>404</h1>';
  return {
    reply: {
      data: body,
      protocol: 'http',
      label: `HTTP ${status} ${REASONS[status]}`,
      http: { type: 'response', version: 'HTTP/1.1', status, reason: REASONS[status], contentType: 'text/html', contentLength: body.length, title: page ? page.title : '404' },
      explain: note('http.response', { name: device.name, status, reason: REASONS[status], len: body.length }),
    },
  };
}

export default {
  id: 'http',
  name: 'HTTP',
  layer: 'application',
  requires: ['tcp', 'dns'],
  actions: ['http'],
  texts,

  install(device, net) {
    if (!device.sendIp) return;
    device.httpLast = null; // dernière réponse reçue (côté client)
    const service = device.def.services && device.def.services.http;
    if (!service) return;
    net.registry.get('tcp').listen(device, service.port || HTTP_PORT, {
      onData: (conn, data, packet) => (packet.http ? respond(device, service.pages || {}, packet) : undefined),
    });
  },

  /** Action de scénario : { action: 'http', from, url }. */
  start(net, step) {
    const device = net.device(step.from);
    const target = parseUrl(step.url);
    if (!device || !device.sendIp || !target) return false;
    const tcp = net.registry.get('tcp');
    const dns = net.registry.get('dns');
    net.info(device, [note('http.start', { name: device.name, url: step.url, host: target.host, port: target.port })]);

    const open = (ip) => tcp.connect(device, { dst: ip, port: target.port }, {
      onOpen: (conn) => tcp.send(conn, `GET ${target.path} HTTP/1.1`, {
        protocol: 'http',
        label: `HTTP GET ${target.path}`,
        http: { type: 'request', method: 'GET', path: target.path, version: 'HTTP/1.1', host: target.host },
        explain: note('http.request', { name: device.name, path: target.path, host: target.host }),
      }),
      onData: (conn, data, packet) => {
        device.httpLast = packet.http || null;
        const http = packet.http || {};
        net.info(device, [note('http.rendered', { name: device.name, status: http.status, title: http.title })]);
        return { close: true };
      },
    });

    if (isIp(target.host)) {
      open(target.host);
      return true;
    }
    dns.resolve(device, target.host, (ip) => {
      if (ip) open(ip);
      else net.info(device, [note('http.dnsFailed', { name: device.name, host: target.host })]);
    });
    return true;
  },

  describe(packet) {
    if (!packet.http) return [];
    const { http } = packet;
    if (http.type === 'request') {
      return [
        { label: { fr: 'Requête', en: 'Request' }, value: `${http.method} ${http.path} ${http.version}` },
        { label: { fr: 'En-tête Host', en: 'Host header' }, value: http.host },
      ];
    }
    return [
      { label: { fr: 'Réponse', en: 'Response' }, value: `${http.version} ${http.status} ${http.reason}` },
      { label: { fr: 'Content-Type', en: 'Content-Type' }, value: http.contentType },
      { label: { fr: 'Content-Length', en: 'Content-Length' }, value: http.contentLength },
    ];
  },
};
