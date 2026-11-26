// Application 100 % WebGPU : la vérification faite avant de créer le moteur de rendu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireWebGPU, WebGPUUnavailableError } from '../src/render/webgpu.mjs';

const reasonOf = async (gpu) => {
  try {
    await requireWebGPU(gpu);
    return 'ok';
  } catch (error) {
    assert.ok(error instanceof WebGPUUnavailableError);
    return error.reason;
  }
};

test('WebGPU : navigateur sans WebGPU → « absent »', async () => {
  assert.equal(await reasonOf(undefined), 'absent');
  assert.equal(await reasonOf({}), 'absent');
});

test('WebGPU : pas de carte graphique utilisable → « adapter »', async () => {
  assert.equal(await reasonOf({ requestAdapter: async () => null }), 'adapter');
  assert.equal(await reasonOf({ requestAdapter: async () => { throw new Error('refusé'); } }), 'adapter');
});

test('WebGPU : carte disponible → adaptateur rendu', async () => {
  let asked = 0;
  const adapter = { name: 'carte' };
  const result = await requireWebGPU({ requestAdapter: async () => { asked += 1; return adapter; } });
  assert.equal(result, adapter);
  assert.equal(asked, 1);
});

test("WebGPU : aucun secours WebGL dans le code de l'application", async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const root = new URL('../src/', import.meta.url);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(entry.name + '/', dir));
      else if (entry.name.endsWith('.mjs')) files.push(new URL(entry.name, dir));
    }
  };
  walk(root);
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /forceWebGL\s*:\s*(true|[a-z])/i, `${file.pathname} force WebGL`);
    assert.doesNotMatch(code, /backend=webgl|getContext\(\s*['"]webgl/i, `${file.pathname} utilise WebGL`);
  }
});
