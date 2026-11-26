// Mode VR (WebXR) — point d'entrée appelé par main.js.
//
// Ce fichier vérifie si une session « immersive-vr » est possible (vrai casque ou
// extension Immersive Web Emulator) puis confie le bouton et la session à session.js.

import { isVRSupported } from './support.js';
import { initVRSession } from './session.js';

export async function initXR(app) {
  const slot = document.getElementById('xr-slot');
  app.xr = { supported: false, session: null };
  // La VR fonctionne avec les deux moteurs, WebGPU compris (src/xr/gpuBridge.js).
  app.xr.supported = await isVRSupported();
  initVRSession(app, slot);
}
