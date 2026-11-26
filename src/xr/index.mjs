// Mode VR (WebXR) — point d'entrée appelé par main.mjs.
//
// Ce fichier vérifie si une session « immersive-vr » est possible (vrai casque ou
// extension Immersive Web Emulator) puis confie le bouton et la session à session.mjs.

import { isVRSupported } from './support.mjs';
import { initVRSession } from './session.mjs';

export async function initXR(app) {
  const slot = document.getElementById('xr-slot');
  app.xr = { supported: false, session: null };
  // La VR fonctionne avec les deux moteurs, WebGPU compris (src/xr/gpuBridge.mjs).
  app.xr.supported = await isVRSupported();
  initVRSession(app, slot);
}
