// Détection de WebXR.

/**
 * La VR immersive est-elle possible ici ?
 * WebXR exige un contexte sécurisé (HTTPS, ou localhost en développement) et un casque
 * ou un émulateur (extension Immersive Web Emulator).
 * @returns {Promise<boolean>}
 */
export async function isVRSupported() {
  if (!window.isSecureContext || !navigator.xr || !navigator.xr.isSessionSupported) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}
