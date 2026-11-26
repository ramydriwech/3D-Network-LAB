// WebGPU obligatoire : l'application dessine en WebGPU seulement, à l'écran comme en VR.
//
// requireWebGPU() vérifie, avant de créer le moteur de rendu, que le navigateur connaît WebGPU
// et fournit une carte graphique (« adaptateur »). Sinon, WebGPUUnavailableError indique
// pourquoi ('absent', 'adapter' ou 'init'), et src/render/index.mjs affiche un message qui dit
// quels navigateurs conviennent. Module pur (sans Three.js) : testé dans tests/webgpu.test.mjs.

/** WebGPU indisponible : la scène ne peut pas s'afficher (message dans src/render/index.mjs). */
export class WebGPUUnavailableError extends Error {
  /** @param {'absent'|'adapter'|'init'} reason */
  constructor(reason, detail = '') {
    super(`WebGPU indisponible (${reason})${detail ? ` : ${detail}` : ''}`);
    this.name = 'WebGPUUnavailableError';
    this.reason = reason;
  }
}

/**
 * Vérifie que WebGPU est utilisable : l'API existe et le navigateur fournit une carte graphique
 * (« adaptateur »). Lève WebGPUUnavailableError sinon : 'absent' (navigateur sans WebGPU) ou
 * 'adapter' (WebGPU désactivé, carte ou pilote refusés).
 */
export async function requireWebGPU(gpu = globalThis.navigator && globalThis.navigator.gpu) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') throw new WebGPUUnavailableError('absent');
  let adapter = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new WebGPUUnavailableError('adapter', error && error.message);
  }
  if (!adapter) throw new WebGPUUnavailableError('adapter');
  return adapter;
}
