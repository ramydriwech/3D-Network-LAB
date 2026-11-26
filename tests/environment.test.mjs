// Environnement lumineux calculé (src/render/environment.mjs) : données pures, sans navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_KINDS, environmentPixels, AMBIENCES } from '../src/render/environment.mjs';

/** Luminance moyenne d'une bande de lignes [from, to[ (0 = bas). */
function bandLuminance({ data, width }, from, to) {
  let sum = 0;
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }
  return sum / ((to - from) * width);
}

test('environnement : deux ambiances, chacune avec ses réglages de lumière', () => {
  assert.deepEqual([...ENVIRONMENT_KINDS], ['studio', 'lab']);
  for (const kind of ENVIRONMENT_KINDS) {
    const ambience = AMBIENCES[kind];
    assert.ok(ambience, kind);
    for (const key of ['environment', 'hemisphere', 'sun']) assert.ok(ambience[key] >= 0, `${kind}.${key}`);
    assert.equal(ambience.sunDirection.length, 3);
    assert.ok(ambience.sunDirection[1] > 0, `${kind} : la lumière vient d'en haut`);
  }
});

test('environnement : image RGBA complète, valeurs finies et positives, alpha à 1', () => {
  for (const kind of ENVIRONMENT_KINDS) {
    const image = environmentPixels(kind, 64, 32);
    assert.equal(image.data.length, 64 * 32 * 4);
    for (let i = 0; i < image.data.length; i += 1) {
      assert.ok(Number.isFinite(image.data[i]) && image.data[i] >= 0, `${kind} : valeur ${i}`);
      if (i % 4 === 3) assert.equal(image.data[i], 1);
    }
  }
});

test('environnement : la lumière vient d\'en haut, et les sources dépassent 1 (HDR)', () => {
  for (const kind of ENVIRONMENT_KINDS) {
    const image = environmentPixels(kind, 128, 64);
    const ground = bandLuminance(image, 0, 16); // ligne 0 = vers le bas
    const sky = bandLuminance(image, 40, 64);
    assert.ok(sky > ground * 1.5, `${kind} : le haut (${sky.toFixed(2)}) est plus lumineux que le bas (${ground.toFixed(2)})`);
    assert.ok(Math.max(...image.data) > 3, `${kind} : au moins une source lumineuse HDR`);
  }
});

test('environnement : le laboratoire a une rangée de dalles LED au plafond', () => {
  const image = environmentPixels('lab', 256, 128);
  // Au plafond (lignes du haut), on alterne dalles très claires et plafond ordinaire.
  const row = 110;
  let bright = 0;
  for (let x = 0; x < image.width; x += 1) if (image.data[(row * image.width + x) * 4] > 3) bright += 1;
  assert.ok(bright > 20 && bright < image.width - 20, `dalles et intervalles (${bright} pixels clairs)`);
});
