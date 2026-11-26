// Bouton « Installer » : quel geste expliquer selon le navigateur (src/ui/installHelp.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHelpKey } from '../src/ui/installHelp.mjs';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0',
};

test('Installer : chaque navigateur a son explication', () => {
  assert.equal(installHelpKey(UA.chromeWin), 'chrome');
  assert.equal(installHelpKey(UA.edgeWin), 'edge');
  assert.equal(installHelpKey(UA.firefoxWin), 'firefox');
  assert.equal(installHelpKey(UA.safariMac), 'safari');
  assert.equal(installHelpKey(UA.iphone), 'ios');
  assert.equal(installHelpKey(UA.chromeAndroid), 'android');
  assert.equal(installHelpKey(UA.firefoxAndroid), 'android');
});

test('Installer : un iPad qui se présente comme un Mac est reconnu à son écran tactile', () => {
  assert.equal(installHelpKey(UA.safariMac, { touchPoints: 5 }), 'ios');
  assert.equal(installHelpKey(UA.safariMac, { touchPoints: 0 }), 'safari');
});

test('Installer : navigateur inconnu → explication de Chrome', () => {
  assert.equal(installHelpKey(''), 'chrome');
  assert.equal(installHelpKey(undefined), 'chrome');
});
