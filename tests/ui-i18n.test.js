// Tests de la langue de l'interface (fr/en). i18n.js n'a pas besoin de navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerStrings, t, localize, formatNote, setLang, getLang, onLangChange, LANGS } from '../src/ui/i18n.js';

test('i18n : français par défaut, bascule en anglais, abonnés prévenus', () => {
  registerStrings({ fr: { 'test.hello': 'Bonjour {name}' }, en: { 'test.hello': 'Hello {name}' } });
  assert.equal(getLang(), 'fr');
  assert.equal(t('test.hello', { name: 'PC1' }), 'Bonjour PC1');
  const seen = [];
  const off = onLangChange((lang) => seen.push(lang));
  setLang('en');
  assert.equal(t('test.hello', { name: 'PC1' }), 'Hello PC1');
  setLang('xx'); // langue inconnue : ignorée
  assert.equal(getLang(), 'en');
  off();
  setLang('fr');
  assert.deepEqual(seen, ['en']);
});

test('i18n : clé absente = la clé elle-même ; texte { fr, en } localisé', () => {
  assert.equal(t('cle.absente'), 'cle.absente');
  assert.equal(localize({ fr: 'Routeur', en: 'Router' }), 'Routeur');
  assert.equal(localize('PC1'), 'PC1');
  assert.equal(localize(null), '');
  assert.equal(localize(64), '64');
});

test('i18n : une note d\'explication est mise en forme avec ses paramètres', () => {
  const sim = { text: (key) => (key === 'demo' ? { fr: '{name} envoie vers {how}', en: '{name} sends to {how}' } : null) };
  assert.equal(formatNote(sim, { key: 'demo', params: { name: 'PC1', how: { fr: 'la passerelle', en: 'the gateway' } } }), 'PC1 envoie vers la passerelle');
  assert.equal(formatNote(sim, { key: 'inconnue', params: {} }), 'inconnue');
});

test('i18n : chaque module d\'interface déclare ses textes dans les deux langues', () => {
  assert.deepEqual([...LANGS], ['fr', 'en']);
  const keysOf = (block) => [...block.matchAll(/'([\w.]+)'\s*:/g)].map((m) => m[1]).sort();
  for (const directory of ['../src/ui/', '../src/xr/']) {
    const base = new URL(directory, import.meta.url);
    for (const file of fs.readdirSync(base).filter((name) => name.endsWith('.js'))) {
      // Les lignes de commentaire sont retirées : elles contiennent des exemples d'appel.
      const source = fs.readFileSync(new URL(file, base), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      let calls = 0;
      for (const call of source.matchAll(/registerStrings\(\{\s*fr:\s*\{([\s\S]*?)\},\s*en:\s*\{([\s\S]*?)\},?\s*\}\);/g)) {
        calls += 1;
        assert.deepEqual(keysOf(call[1]), keysOf(call[2]), `${file} : clés fr et en différentes`);
      }
      if (source.includes('registerStrings({')) assert.ok(calls > 0, `${file} : registerStrings() non reconnu par ce test`);
    }
  }
});
