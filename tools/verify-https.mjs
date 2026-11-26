// Vérification du site publié en HTTPS (demande du superviseur : sécurité du déploiement).
//
//   node tools/verify-https.mjs https://<compte>.github.io/<dépôt>/
//
// Ce que l'outil contrôle, et pourquoi :
//   1. le site répond en HTTPS (code 200) — sinon rien d'autre n'a de sens ;
//   2. la poignée de main TLS : version (TLS 1.2 minimum, 1.3 conseillé), suite de chiffrement,
//      échange de clés — une vieille version de TLS est vulnérable ;
//   3. le certificat : vérifié par une autorité reconnue, au bon nom d'hôte, pas expiré, et
//      combien de jours il lui reste (alerte sous WARN_DAYS) ;
//   4. HTTP renvoie bien vers HTTPS (sinon un visiteur peut rester en clair) ;
//   5. l'en-tête HSTS, qui oblige le navigateur à revenir toujours en HTTPS.
//
// Sans dépendance : seulement les modules tls, https et http de Node.
// Code de sortie : 0 si tout va bien (avertissements compris), 1 si un contrôle bloquant
// échoue, 2 si l'adresse est mal écrite. Dans GitHub Actions, un tableau récapitulatif est
// ajouté à la page de l'exécution ($GITHUB_STEP_SUMMARY).
//
// Variables : ATTEMPTS (8) et DELAY (15 s) pour laisser GitHub Pages publier après un
// déploiement ; WARN_DAYS (14) ; TIMEOUT (15 s) par requête.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const ATTEMPTS = Number(process.env.ATTEMPTS || 8);
const DELAY = Number(process.env.DELAY || 15) * 1000;
const WARN_DAYS = Number(process.env.WARN_DAYS || 14);
const TIMEOUT = Number(process.env.TIMEOUT || 15) * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY = 24 * 3600 * 1000;

/** Résultats : { level: 'ok' | 'warn' | 'fail', label, value }. */
export function createReport() {
  const rows = [];
  return {
    rows,
    ok: (label, value) => rows.push({ level: 'ok', label, value }),
    warn: (label, value) => rows.push({ level: 'warn', label, value }),
    fail: (label, value) => rows.push({ level: 'fail', label, value }),
    get failed() { return rows.some((row) => row.level === 'fail'); },
  };
}

/** Requête GET sans suivre les redirections : { status, headers }. */
function get(module, url) {
  return new Promise((resolve, reject) => {
    const request = module.get(url, { timeout: TIMEOUT, headers: { 'user-agent': 'verify-https (3D Network Topology)' } }, (response) => {
      response.resume();
      resolve({ status: response.statusCode, headers: response.headers });
    });
    request.on('timeout', () => request.destroy(new Error('délai dépassé')));
    request.on('error', reject);
  });
}

/** Poignée de main TLS seule : protocole, chiffrement, échange de clés, certificat. */
function handshake(host, port = 443, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: TIMEOUT, ...options }, () => {
      const result = {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher(),
        ephemeral: socket.getEphemeralKeyInfo ? socket.getEphemeralKeyInfo() : null,
        certificate: socket.getPeerCertificate(false),
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => socket.destroy(new Error('délai dépassé')));
    socket.on('error', reject);
  });
}

/** Jours restants avant l'expiration d'un certificat (valid_to au format OpenSSL). */
export function daysLeft(validTo, now = Date.now()) {
  return Math.trunc((new Date(validTo).getTime() - now) / DAY);
}

/** Analyse d'une poignée de main déjà faite (séparée pour être testée sans réseau). */
export function judgeHandshake(report, result, { warnDays = WARN_DAYS, now = Date.now() } = {}) {
  if (!result.authorized) report.fail('Certificat vérifié', result.authorizationError || 'refusé');
  else report.ok('Certificat vérifié', 'chaîne de confiance et nom d\'hôte valides');
  const version = result.protocol || '?';
  if (version === 'TLSv1.3') report.ok('Version TLS', version);
  else if (version === 'TLSv1.2') report.warn('Version TLS', `${version} (correct ; TLS 1.3 est préférable)`);
  else report.fail('Version TLS', `${version} : trop ancienne, vulnérable`);
  if (result.cipher) report.ok('Suite de chiffrement', `${result.cipher.standardName || result.cipher.name} (${result.cipher.version})`);
  if (result.ephemeral && result.ephemeral.type) {
    report.ok('Échange de clés', `${result.ephemeral.type}${result.ephemeral.name ? ' ' + result.ephemeral.name : ''} ${result.ephemeral.size || ''} bits (confidentialité persistante)`.trim());
  }
  const cert = result.certificate || {};
  if (cert.subject) report.ok('Sujet du certificat', cert.subject.CN || JSON.stringify(cert.subject));
  if (cert.issuer) report.ok('Émetteur', [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(' — '));
  if (cert.valid_to) {
    const left = daysLeft(cert.valid_to, now);
    const range = `${cert.valid_from} → ${cert.valid_to}`;
    if (left < 0) report.fail('Validité', `expiré depuis ${-left} jour(s) (${range})`);
    else if (left < warnDays) report.warn('Validité', `expire dans ${left} jour(s) (${range})`);
    else report.ok('Validité', `encore ${left} jours (${range})`);
  }
}

/** HSTS : présent, et d'une durée raisonnable (au moins 6 mois conseillés). */
export function judgeHsts(report, header) {
  if (!header) {
    report.warn('En-tête HSTS', 'absent (GitHub Pages ne l\'envoie que sur les domaines personnalisés)');
    return;
  }
  const maxAge = Number((/max-age=(\d+)/i.exec(header) || [])[1] || 0);
  if (maxAge >= 182 * 24 * 3600) report.ok('En-tête HSTS', header);
  else report.warn('En-tête HSTS', `${header} (durée courte : au moins 15768000 s conseillé)`);
}

function writeSummary(url, report) {
  const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
  const lines = [`### Vérification HTTPS — ${url}`, '', '| | Contrôle | Résultat |', '|---|---|---|'];
  for (const row of report.rows) lines.push(`| ${icon[row.level]} | ${row.label} | ${String(row.value).replace(/\|/g, '\\|')} |`);
  lines.push('');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  for (const row of report.rows) {
    const prefix = row.level === 'fail' && process.env.GITHUB_ACTIONS ? '::error::' : row.level === 'warn' && process.env.GITHUB_ACTIONS ? '::warning::' : '';
    console.log(`${prefix}${icon[row.level]} ${row.label} : ${row.value}`);
  }
}

export async function verify(url) {
  const report = createReport();
  const host = url.hostname;

  // 1. Le site répond-il en HTTPS ? (une publication peut prendre une minute)
  let page = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      page = await get(https, url);
      if (page.status === 200) break;
    } catch (error) {
      page = { status: 0, error: error.message };
    }
    if (attempt < ATTEMPTS) await sleep(DELAY);
  }
  if (!page || page.status !== 200) {
    report.fail('Réponse HTTPS', page && page.error ? page.error : `code ${page ? page.status : '?'}`);
    return report;
  }
  report.ok('Réponse HTTPS', `code ${page.status}`);

  // 2-3. Poignée de main TLS et certificat
  try {
    judgeHandshake(report, await handshake(host, 443, { rejectUnauthorized: false }));
  } catch (error) {
    report.fail('Poignée de main TLS', error.message);
  }
  // TLS 1.2 doit rester accepté (anciens navigateurs) ; TLS 1.1 doit être refusé.
  try {
    await handshake(host, 443, { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    report.ok('TLS 1.2 accepté', 'oui (compatibilité)');
  } catch {
    report.warn('TLS 1.2 accepté', 'non : seuls les navigateurs récents (TLS 1.3) peuvent se connecter');
  }
  try {
    await handshake(host, 443, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
    report.fail('TLS 1.0/1.1 refusé', 'non : une version obsolète est encore acceptée');
  } catch {
    report.ok('TLS 1.0/1.1 refusé', 'oui');
  }

  // 4. HTTP → HTTPS
  try {
    const plain = await get(http, new URL(url.pathname + url.search, `http://${host}`));
    const location = plain.headers.location || '';
    if (plain.status >= 300 && plain.status < 400 && location.startsWith('https://')) report.ok('Redirection HTTP → HTTPS', `${plain.status} → ${location}`);
    else report.warn('Redirection HTTP → HTTPS', `absente (code ${plain.status})`);
  } catch (error) {
    report.warn('Redirection HTTP → HTTPS', `HTTP injoignable (${error.message})`);
  }

  // 5. HSTS
  judgeHsts(report, page.headers['strict-transport-security']);
  return report;
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  const raw = process.argv[2] || process.env.SITE_URL;
  let url;
  try {
    url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('https:// attendu');
  } catch (error) {
    console.error(`Usage : node tools/verify-https.mjs https://hôte/chemin/  (${error.message})`);
    process.exit(2);
  }
  const report = await verify(url);
  writeSummary(url.href, report);
  process.exit(report.failed ? 1 : 0);
}
