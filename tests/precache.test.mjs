import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, buildManifest, render } from '../tools/generate-precache.mjs';

function fakeSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'precache-'));
  const write = (file, content = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  ['index.html', 'styles.css', 'main.mjs', 'simulation.mjs', 'manifest.json', 'sw.mjs', 'README.md', 'package.json',
    'src/ui/index.mjs', 'scenarios/ping.json', 'assets/models/pc.glb', 'vendor/three/three.module.mjs', 'vendor/three/LICENSE',
    'tests/a.test.mjs', 'docs/manuel.md', 'tools/serve.mjs', '.github/workflows/ci.yml', 'src/.DS_Store'].forEach((file) => write(file));
  return { root, write };
}

test('pré-cache : seuls les fichiers utiles au navigateur sont listés', () => {
  const { root } = fakeSite();
  assert.deepEqual(listFiles(root), [
    'assets/models/pc.glb', 'index.html', 'main.mjs', 'manifest.json', 'scenarios/ping.json',
    'simulation.mjs', 'src/ui/index.mjs', 'styles.css', 'vendor/three/three.module.mjs',
  ]);
});

test('pré-cache : la version change quand un fichier change', () => {
  const { root, write } = fakeSite();
  const before = buildManifest(root);
  assert.equal(buildManifest(root).version, before.version, 'même contenu = même version');
  assert.equal(before.files[0], './', 'la page d\'accueil est en cache');
  write('scenarios/ping.json', 'modifié');
  assert.notEqual(buildManifest(root).version, before.version);
  write('scenarios/tcp.json');
  assert.ok(buildManifest(root).files.includes('scenarios/tcp.json'), 'un fichier ajouté est pris tout seul');
});

test('pré-cache : le fichier généré définit self.__PRECACHE', () => {
  const self = {};
  new Function('self', render({ version: 'abc', files: ['./'] }))(self);
  assert.deepEqual(self.__PRECACHE, { version: 'abc', files: ['./'] });
});

test('pré-cache : tous les fichiers du vrai dépôt existent', () => {
  const root = fileURLToPath(new URL('..', import.meta.url)); // fileURLToPath : chemin correct aussi sous Windows
  for (const file of listFiles()) assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.ok(listFiles().includes('index.html'));
});
