// Niveaux de qualité du rendu (src/render/quality.mjs) : données pures, sans navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_SETTINGS, QUALITY_STORAGE_KEY, parseQuality, readQualitySetting, storeQualitySetting, resolveQuality, qualityPreset,
} from '../src/render/quality.mjs';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); }, data };
}

test('qualité : trois réglages, seuls les réglages connus sont acceptés', () => {
  assert.deepEqual([...QUALITY_SETTINGS], ['auto', 'low', 'high']);
  assert.equal(parseQuality('high'), 'high');
  assert.equal(parseQuality('ultra'), null);
  assert.equal(parseQuality(undefined), null);
});

test('qualité : l\'adresse l\'emporte sur le choix mémorisé, « auto » par défaut', () => {
  const storage = memoryStorage({ [QUALITY_STORAGE_KEY]: 'low' });
  assert.equal(readQualitySetting({ search: '?quality=high', storage }), 'high');
  assert.equal(readQualitySetting({ search: '?scenario=ping', storage }), 'low');
  assert.equal(readQualitySetting({ search: '?quality=n-importe', storage: memoryStorage() }), 'auto');
  assert.equal(readQualitySetting(), 'auto');
  const broken = { getItem() { throw new Error('navigation privée'); } };
  assert.equal(readQualitySetting({ storage: broken }), 'auto', 'stockage indisponible : pas d\'erreur');
});

test('qualité : le choix est mémorisé, un réglage inconnu est ignoré', () => {
  const storage = memoryStorage();
  storeQualitySetting('high', storage);
  assert.equal(storage.data[QUALITY_STORAGE_KEY], 'high');
  storeQualitySetting('ultra', storage);
  assert.equal(storage.data[QUALITY_STORAGE_KEY], 'high');
  assert.doesNotThrow(() => storeQualitySetting('low', { setItem() { throw new Error('plein'); } }));
});

test('qualité : « auto » choisit Basse sur écran tactile et Haute à la souris', () => {
  assert.equal(resolveQuality('auto', { coarse: true }), 'low');
  assert.equal(resolveQuality('auto', { coarse: false }), 'high');
  assert.equal(resolveQuality('high', { coarse: true }), 'high', 'un choix explicite est respecté');
  assert.equal(resolveQuality('low'), 'low');
});

test('qualité : seule la qualité haute a des ombres portées ; densité de pixels plafonnée', () => {
  const low = qualityPreset('low');
  const high = qualityPreset('high');
  assert.equal(low.shadows, false);
  assert.equal(high.shadows, true);
  assert.ok(high.shadowMapSize >= 1024 && (high.shadowMapSize & (high.shadowMapSize - 1)) === 0, 'puissance de deux');
  assert.ok(low.pixelRatioCap <= 1.5 && high.pixelRatioCap <= 2);
  assert.equal(qualityPreset('inconnu'), low, 'repli prudent');
});
