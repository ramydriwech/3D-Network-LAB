// VR avec le moteur WebGPU (demande de l'enseignant : WebGPU partout, VR comprise).
//
// Trois façons d'ouvrir une session immersive, essayées dans cet ordre :
//
//   1. « native » — le navigateur sait relier WebXR à WebGPU (objet XRGPUBinding et
//      fonctionnalité de session « webgpu ») : Three.js r187 dessine directement dans les
//      textures du casque. C'est la voie d'avenir (casques et navigateurs récents).
//
//   2. « pont » — WebGPU dessine dans le canevas de la page, et notre propre boucle XR lit la
//      position de la tête et des manettes. Cela fonctionne avec l'Immersive Web Emulator
//      (extension Chrome) et IWER, qui affichent justement le canevas de la page. La session
//      demande un « calque » WebGL : on lui passe une simple surface qui décrit le canevas,
//      sans jamais créer de contexte WebGL.
//
//   3. « webgl » — le moteur est en WebGL 2 (WebGPU absent, ou ?backend=webgl) : on garde la
//      voie classique de Three.js, comme avant.
//
// Un vrai casque dont le navigateur n'a pas encore XRGPUBinding refuse le pont (il exige un
// vrai contexte WebGL) : la session est refermée et un message clair explique comment
// faire (activer WebGPU-WebXR dans le navigateur, ou recharger avec ?backend=webgl).

import * as THREE from 'three';

/** Erreur avec un texte prêt à afficher dans les deux langues. */
export class XRBridgeError extends Error {
  constructor(key, cause) {
    super(key);
    this.key = key;
    this.cause = cause;
  }
}

const SESSION_FEATURES = ['local-floor', 'bounded-floor'];

/**
 * Surface minimale décrivant le canevas : c'est tout ce qu'un émulateur WebXR lit dans un
 * « contexte » (sa taille, et des réglages d'effacement qu'il n'utilise pas ici).
 */
function canvasSurface(canvas) {
  return {
    canvas,
    COLOR_CLEAR_VALUE: 0x0c22, DEPTH_CLEAR_VALUE: 0x0b73, STENCIL_CLEAR_VALUE: 0x0b91,
    DEPTH_BUFFER_BIT: 0x100, COLOR_BUFFER_BIT: 0x4000, STENCIL_BUFFER_BIT: 0x400,
    getParameter: (name) => (name === 0x0c22 ? [0, 0, 0, 0] : 0),
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false }),
    makeXRCompatible: async () => {},
    clearColor() {}, clearDepth() {}, clearStencil() {}, clear() {},
  };
}

/**
 * Manettes du pont : un groupe Three.js par main, placé à chaque image d'après la pose de
 * la manette, et qui relaie l'évènement « select » de la session (même interface que
 * renderer.xr.getController(i), pour que controllers.js serve aux trois voies).
 */
function createRig(session) {
  const hands = [new THREE.Group(), new THREE.Group()];
  for (const hand of hands) {
    hand.matrixAutoUpdate = false;
    hand.visible = false;
  }
  const slotOf = (source) => {
    const sources = [...session.inputSources].filter((item) => item.targetRaySpace);
    const index = source.handedness === 'left' ? 0 : source.handedness === 'right' ? 1 : sources.indexOf(source);
    return hands[Math.max(0, Math.min(1, index))];
  };
  const relay = (event) => slotOf(event.inputSource).dispatchEvent({ type: event.type, data: event.inputSource });
  for (const type of ['select', 'selectstart', 'selectend', 'squeeze']) session.addEventListener(type, relay);
  return {
    getController: (index) => hands[index],
    update(frame, space) {
      for (const hand of hands) hand.visible = false;
      for (const source of session.inputSources) {
        if (!source.targetRaySpace) continue;
        const pose = frame.getPose(source.targetRaySpace, space);
        if (!pose) continue;
        const hand = slotOf(source);
        hand.matrix.fromArray(pose.transform.matrix);
        hand.matrix.decompose(hand.position, hand.quaternion, hand.scale);
        hand.matrixWorldNeedsUpdate = true;
        hand.visible = true;
      }
    },
    dispose() {
      for (const type of ['select', 'selectstart', 'selectend', 'squeeze']) session.removeEventListener(type, relay);
    },
  };
}

/** Vrai si ce navigateur peut relier WebXR et WebGPU directement. */
export function nativeWebGPUXR() {
  return typeof globalThis.XRGPUBinding !== 'undefined';
}

/**
 * Ouvre une session VR adaptée au moteur de rendu.
 * @param {Object} render  API de rendu (renderer, scene, camera, backend, runFrame…)
 * @param {{ onEnd: Function }} hooks
 * @returns {Promise<{ session, mode: 'native'|'bridge'|'webgl', rig, end(): void }>}
 */
export async function openVR(render, { onEnd }) {
  const { renderer } = render;

  // 3. Moteur WebGL 2 : voie classique de Three.js.
  if (render.backend !== 'webgpu') {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: SESSION_FEATURES });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    session.addEventListener('end', () => onEnd(), { once: true });
    return { session, mode: 'webgl', rig: renderer.xr, end: () => session.end() };
  }

  // 1. WebGPU relié à WebXR par le navigateur.
  if (nativeWebGPUXR()) {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['webgpu'], optionalFeatures: SESSION_FEATURES });
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(session);
      session.addEventListener('end', () => onEnd(), { once: true });
      return { session, mode: 'native', rig: renderer.xr, end: () => session.end() };
    } catch (error) {
      console.info('[vr] WebGPU-WebXR refusé, essai du pont :', error.message || error);
    }
  }

  // 2. Pont : WebGPU dessine dans le canevas, notre boucle suit la tête et les manettes.
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
  let layer;
  try {
    layer = new XRWebGLLayer(session, canvasSurface(renderer.domElement));
  } catch (error) {
    await session.end().catch(() => {});
    throw new XRBridgeError('xr.needWebGPUXR', error);
  }
  session.updateRenderState({ baseLayer: layer, depthNear: 0.05, depthFar: 200 });
  let space;
  try {
    space = await session.requestReferenceSpace('local-floor');
  } catch {
    space = await session.requestReferenceSpace('local');
  }

  const canvas = renderer.domElement;
  const rig = createRig(session);
  render.scene.add(rig.getController(0), rig.getController(1));
  const eyes = new THREE.ArrayCamera([]);
  eyes.matrixAutoUpdate = false;
  eyes.matrixWorldAutoUpdate = false;
  const previous = { pixelRatio: renderer.getPixelRatio() };
  let running = true;

  /** Une image : pose de la tête → une caméra par œil, puis la boucle habituelle de l'application. */
  function onFrame(time, frame) {
    if (!running) return;
    session.requestAnimationFrame(onFrame);
    const pose = frame.getViewerPose(space);
    if (!pose) return;
    if (renderer.getPixelRatio() !== 1) renderer.setPixelRatio(1);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== canvas.width || size.y !== canvas.height) renderer.setSize(canvas.width, canvas.height, false);
    // Une vue de largeur nulle (affichage « mono » de l'émulateur) est ignorée.
    const views = pose.views.filter((view) => layer.getViewport(view).width > 0);
    eyes.cameras.length = views.length;
    views.forEach((view, i) => {
      const eye = eyes.cameras[i] || (eyes.cameras[i] = new THREE.PerspectiveCamera());
      const viewport = layer.getViewport(view);
      eye.viewport = new THREE.Vector4(viewport.x, viewport.y, viewport.width, viewport.height);
      eye.projectionMatrix.fromArray(view.projectionMatrix);
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
      eye.matrixWorld.fromArray(view.transform.matrix);
      eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
      eye.matrixAutoUpdate = false;
      eye.matrixWorldAutoUpdate = false;
    });
    if (!views.length) return;
    eyes.projectionMatrix.copy(eyes.cameras[0].projectionMatrix);
    eyes.projectionMatrixInverse.copy(eyes.cameras[0].projectionMatrixInverse);
    eyes.matrixWorld.copy(eyes.cameras[0].matrixWorld);
    eyes.matrixWorldInverse.copy(eyes.cameras[0].matrixWorldInverse);
    // La caméra principale suit la tête : les étiquettes et le panneau s'orientent vers elle.
    render.camera.matrixWorld.copy(eyes.matrixWorld);
    render.camera.matrixWorld.decompose(render.camera.position, render.camera.quaternion, render.camera.scale);
    rig.update(frame, space);
    render.runFrame(time, () => renderer.render(render.scene, eyes));
  }

  render.pauseLoop();
  render.bridgePresenting = true;
  session.requestAnimationFrame(onFrame);
  session.addEventListener('end', () => {
    running = false;
    rig.dispose();
    render.scene.remove(rig.getController(0), rig.getController(1));
    render.bridgePresenting = false;
    renderer.setPixelRatio(previous.pixelRatio);
    render.resumeLoop();
    onEnd();
  }, { once: true });
  return { session, mode: 'bridge', rig, end: () => session.end() };
}
