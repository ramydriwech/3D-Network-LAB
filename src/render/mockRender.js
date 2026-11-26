// Fausse version (mock) de l'API de rendu : mêmes fonctions que le vrai rendu, mais sans
// carte graphique. Elle note les appels reçus. Utile pour tester l'interface ou la simulation sans
// carte graphique, et comme repli si ni WebGPU ni WebGL 2 ne sont disponibles.

import { RENDER_API } from './api.js';

export function createMockRender() {
  const calls = [];
  const frameCallbacks = new Set();
  const record = (name) => (...args) => { calls.push({ name, args }); };
  const zero = () => ({ x: 0, y: 0, z: 0, clone() { return zero(); } });

  const render = {
    isMock: true,
    calls,
    scene: null,
    camera: null,
    renderer: null,
    backend: 'mock',
    domElement: null,
    controls: null,
    world: null,
    packetLayer: { add: record('packetLayer.add'), remove: record('packetLayer.remove') },
    maxPackets: Infinity,
    showTopology: record('showTopology'),
    anchor: (id) => { calls.push({ name: 'anchor', args: [id] }); return zero(); },
    deviceObject: () => null,
    linkPath: () => null, // sans câble 3D : l'animateur retombe sur le trajet en arc
    pickables: () => [],
    highlight: record('highlight'),
    makeLabel: () => null,
    packetStyle: () => ({ color: '#e2e8f0', cast: 'unicast' }),
    packetColor: () => '#e2e8f0',
    legend: () => [],
    setVRMode: record('setVRMode'),
    resize: record('resize'),
    quality: { setting: 'auto', level: 'low', auto: 'low' },
    setQuality(setting) {
      calls.push({ name: 'setQuality', args: [setting] });
      render.quality = { setting, level: setting === 'high' ? 'high' : 'low', auto: 'low' };
      return { ...render.quality };
    },
    onFrame(callback) { frameCallbacks.add(callback); return () => frameCallbacks.delete(callback); },
    /** Sans boucle d'affichage : appeler step(dtMs) à la main pour simuler une image. */
    start(tick) { render.tick = tick; },
    step(dtMs = 16) {
      if (render.tick) render.tick(dtMs);
      for (const callback of frameCallbacks) callback(dtMs);
    },
  };
  for (const name of RENDER_API) {
    if (!(name in render)) throw new Error(`mockRender : « ${name} » manque`);
  }
  return render;
}
