// Panneau « Technologies » : contenu et couleur de chaque ligne (src/ui/techReport.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { techRows, reportText, valueText, gpuName, isHeadsetBrowser } from '../src/ui/techReport.mjs';

const base = {
  secure: true, backend: 'webgpu', threeRevision: '187', gpu: 'intel · xe', quality: { setting: 'auto', level: 'high' },
  xr: true, immersiveVR: false, xrgpuBinding: false, headset: false, serviceWorker: true, cached: true, standalone: false,
};
const level = (facts, id) => techRows({ ...base, ...facts }).find((row) => row.id === id);

test('Technologies : PC ordinaire avec WebGPU, sans casque', () => {
  const rows = techRows(base);
  assert.deepEqual(rows.map((row) => row.id), ['secure', 'render', 'gpu', 'quality', 'webxr', 'immersive', 'binding', 'vr', 'offline', 'installed']);
  assert.equal(level({}, 'render').level, 'ok');
  assert.deepEqual(level({}, 'render').value, { key: 'tech.v.webgpu', params: { revision: '187' } });
  assert.equal(level({}, 'immersive').level, 'na');
  assert.equal(level({}, 'vr').level, 'na');
  assert.equal(level({}, 'offline').level, 'ok');
  assert.equal(level({}, 'installed').level, 'na');
});

test('Technologies : la VR selon le casque et XRGPUBinding', () => {
  // Émulateur sur PC : pas de liaison native, la VR passe par le pont.
  assert.equal(level({ immersiveVR: true }, 'binding').level, 'warn');
  assert.deepEqual([level({ immersiveVR: true }, 'vr').level, level({ immersiveVR: true }, 'vr').value.key], ['ok', 'tech.v.vrBridge']);
  // Vrai casque sans XRGPUBinding : la VR ne marchera pas (rouge, avec le conseil).
  const quest = level({ immersiveVR: true, headset: true }, 'vr');
  assert.deepEqual([quest.level, quest.value.key, quest.tip], ['bad', 'tech.v.vrImpossible', 'tech.tip.binding']);
  assert.equal(level({ immersiveVR: true, headset: true }, 'binding').level, 'bad');
  // Casque dont le navigateur relie WebXR et WebGPU : VR directe.
  assert.deepEqual([level({ immersiveVR: true, headset: true, xrgpuBinding: true }, 'vr').level, level({ immersiveVR: true, xrgpuBinding: true }, 'binding').level], ['ok', 'ok']);
});

test('Technologies : sans WebGPU ni HTTPS', () => {
  const rows = techRows({ ...base, backend: 'mock', secure: false, xr: false, serviceWorker: false, cached: false, quality: null });
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(by.secure.level, 'bad');
  assert.equal(by.render.level, 'bad');
  assert.equal(by.render.tip, 'tech.tip.webgpu');
  assert.equal(by.gpu, undefined); // pas de carte à nommer sans WebGPU
  assert.equal(by.quality, undefined);
  assert.equal(by.vr.level, 'bad');
  assert.equal(by.offline.tip, 'tech.tip.secure');
});

test('Technologies : nom de la carte, navigateur de casque', () => {
  assert.equal(gpuName({ vendor: 'intel', architecture: 'xe-lpg', description: '' }), 'intel · xe-lpg');
  assert.equal(gpuName({ vendor: '', architecture: '', description: 'Apple M3' }), 'Apple M3');
  assert.equal(gpuName(null), '');
  assert.equal(isHeadsetBrowser('Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 OculusBrowser/38.0 Chrome/138.0 Safari/537.36'), true);
  assert.equal(isHeadsetBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36'), false);
});

test('Technologies : rapport en texte, paramètres traduits', () => {
  const words = { 'tech.row.quality': 'Qualité', 'tech.v.quality': '{setting} → {level}', 'tech.q.auto': 'Auto', 'tech.q.high': 'haute' };
  const translate = (key, params = {}) => (words[key] || key).replace(/\{(\w+)\}/g, (all, name) => params[name] ?? all);
  const quality = techRows(base).find((row) => row.id === 'quality');
  assert.equal(valueText(quality, translate), 'Auto → haute');
  assert.equal(reportText([quality], translate, 'Titre'), 'Titre\n✓ Qualité : Auto → haute');
});
