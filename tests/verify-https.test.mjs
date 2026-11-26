// Vérificateur HTTPS (tools/verify-https.mjs) : les jugements sont testés sans réseau,
// à partir de résultats de poignée de main fabriqués.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport, daysLeft, judgeHandshake, judgeHsts } from '../tools/verify-https.mjs';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const good = {
  authorized: true, protocol: 'TLSv1.3',
  cipher: { name: 'TLS_AES_128_GCM_SHA256', standardName: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' },
  ephemeral: { type: 'ECDH', name: 'X25519', size: 253 },
  certificate: { subject: { CN: '*.github.io' }, issuer: { O: 'Autorité', CN: 'AC 1' }, valid_from: 'Mar  1 00:00:00 2026 GMT', valid_to: 'Mar  1 00:00:00 2027 GMT' },
};

test('HTTPS : un site moderne passe tous les contrôles', () => {
  const report = createReport();
  judgeHandshake(report, good, { now: NOW });
  judgeHsts(report, 'max-age=31556952; includeSubDomains');
  assert.equal(report.failed, false);
  assert.ok(report.rows.every((row) => row.level === 'ok'), JSON.stringify(report.rows));
  assert.equal(daysLeft(good.certificate.valid_to, NOW), 103);
});

test('HTTPS : certificat refusé, expiré ou proche de l\'expiration', () => {
  const refused = createReport();
  judgeHandshake(refused, { ...good, authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, { now: NOW });
  assert.equal(refused.failed, true);
  const expired = createReport();
  judgeHandshake(expired, { ...good, certificate: { ...good.certificate, valid_to: 'Nov  1 00:00:00 2026 GMT' } }, { now: NOW });
  assert.match(expired.rows.find((r) => r.label === 'Validité').value, /expiré depuis 16 jour/);
  const soon = createReport();
  judgeHandshake(soon, { ...good, certificate: { ...good.certificate, valid_to: 'Nov 25 00:00:00 2026 GMT' } }, { now: NOW, warnDays: 14 });
  assert.equal(soon.failed, false);
  assert.equal(soon.rows.find((r) => r.label === 'Validité').level, 'warn');
});

test('HTTPS : versions de TLS et en-tête HSTS', () => {
  const old = createReport();
  judgeHandshake(old, { ...good, protocol: 'TLSv1.1' }, { now: NOW });
  assert.equal(old.failed, true);
  const twelve = createReport();
  judgeHandshake(twelve, { ...good, protocol: 'TLSv1.2' }, { now: NOW });
  assert.equal(twelve.failed, false);
  assert.equal(twelve.rows.find((r) => r.label === 'Version TLS').level, 'warn');
  const none = createReport();
  judgeHsts(none, undefined);
  assert.equal(none.rows[0].level, 'warn');
  const short = createReport();
  judgeHsts(short, 'max-age=600');
  assert.equal(short.rows[0].level, 'warn');
});
