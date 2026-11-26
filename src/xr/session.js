// Session VR : le bouton « Entrer en VR » et tout ce qui se passe à l'entrée et à la
// sortie du mode immersif.
//
// À l'entrée : la navigation à la souris est suspendue, la scène passe en mode VR et un
// panneau de contrôle 3D apparaît (le HTML n'est pas visible dans le casque).
// À la sortie : tout est remis exactement comme avant.

import { el } from '../ui/dom.js';
import { onLangChange, registerStrings, t } from '../ui/i18n.js';
import { toast } from '../ui/toast.js';
import { createVRPanel } from './vrPanel.js';
import { initControllers } from './controllers.js';
import { isVRSupported } from './support.js';
import { openVR } from './gpuBridge.js';
import { combinePanels, createVRInfoPanel } from './vrInfoPanel.js';
import { createVRConsole } from './vrConsole.js';

registerStrings({
  fr: {
    'xr.enter': 'Entrer en VR', 'xr.exit': 'Quitter la VR',
    'xr.enter.tip': 'Explorer la topologie en réalité virtuelle (casque ou Immersive Web Emulator)',
    'xr.failed': 'Impossible d\'ouvrir la session VR : {message}',
    'xr.unavailable': 'VR indisponible',
    'xr.unavailable.tip': 'Aucun casque ni émulateur WebXR détecté. L\'application reste entièrement utilisable en mode classique. Pour essayer la VR sur PC : installez l\'extension Immersive Web Emulator dans Chrome puis rechargez la page.',
    'xr.fallback': 'La VR n\'est pas disponible sur cet appareil : vous restez en mode classique.',
    'xr.needWebGPUXR': 'Ce casque ne sait pas encore afficher du WebGPU en VR (il lui manque XRGPUBinding). Activez « WebXR WebGPU » dans les réglages expérimentaux du navigateur, ou rechargez la page avec ?backend=webgl pour utiliser la VR en WebGL 2.',
    'xr.mode.native': 'VR WebGPU (directe)', 'xr.mode.bridge': 'VR WebGPU (pont pour émulateur)', 'xr.mode.webgl': 'VR WebGL 2',
  },
  en: {
    'xr.enter': 'Enter VR', 'xr.exit': 'Exit VR',
    'xr.enter.tip': 'Explore the topology in virtual reality (headset or Immersive Web Emulator)',
    'xr.failed': 'Could not open the VR session: {message}',
    'xr.unavailable': 'VR unavailable',
    'xr.unavailable.tip': 'No WebXR headset or emulator detected. The app remains fully usable in classic mode. To try VR on a PC: install the Immersive Web Emulator extension in Chrome, then reload the page.',
    'xr.fallback': 'VR is not available on this device: you stay in classic mode.',
    'xr.needWebGPUXR': 'This headset cannot display WebGPU in VR yet (it lacks XRGPUBinding). Enable "WebXR WebGPU" in the browser\'s experimental settings, or reload the page with ?backend=webgl to use VR with WebGL 2.',
    'xr.mode.native': 'WebGPU VR (direct)', 'xr.mode.bridge': 'WebGPU VR (emulator bridge)', 'xr.mode.webgl': 'WebGL 2 VR',
  },
});

export function initVRSession(app, slot) {
  const { render } = app;
  const xr = render.renderer ? render.renderer.xr : null;
  const button = el('button', { type: 'button', class: 'btn btn-vr', id: 'vr-button' });
  slot.replaceChildren(button);

  let session = null;
  let panel = null;
  let saved = null; // position de la caméra avant l'entrée en VR
  let controllers = null;

  function refresh() {
    const usable = !!xr && app.xr.supported;
    // Sans WebXR, le bouton reste visible mais grisé, avec l'explication en infobulle :
    // l'utilisateur comprend pourquoi et sait que le mode classique fonctionne.
    button.textContent = usable ? t(session ? 'xr.exit' : 'xr.enter') : t('xr.unavailable');
    button.title = usable ? t('xr.enter.tip') : t('xr.unavailable.tip');
    button.setAttribute('aria-disabled', String(!usable));
    button.classList.toggle('is-disabled', !usable);
  }

  let opened = null; // { session, mode, rig, end }
  let infoPanel = null;
  let vrConsole = null;
  function onStart() {
    saved = { position: render.camera.position.clone(), quaternion: render.camera.quaternion.clone() };
    render.controls.enabled = false;
    // En VR, Steve est dans le laboratoire, à l'échelle réelle (src/render/lab.js).
    if (render.lab) render.lab.enterVR();
    else render.setVRMode(true);
    panel = createVRPanel(app, () => session && session.end());
    render.scene.add(panel.object);
    // Second panneau (étape, fiche technique, diagnostic) à droite ; les manettes visent les deux.
    infoPanel = createVRInfoPanel(app);
    render.scene.add(infoPanel.object);
    // Troisième panneau devant Steve : la console de l'équipement choisi et son clavier 3D.
    vrConsole = createVRConsole(app);
    render.scene.add(vrConsole.object);
    controllers = initControllers(app, combinePanels([panel, infoPanel, vrConsole]), opened.rig);
    app.xr.panels = { controls: panel, info: infoPanel, console: vrConsole }; // utile aux tests de bout en bout
    refresh();
  }

  function onEnd() {
    session = null;
    app.xr.session = null;
    if (controllers) controllers.dispose();
    controllers = null;
    if (panel) {
      render.scene.remove(panel.object);
      panel.dispose();
      panel = null;
    }
    if (infoPanel) {
      render.scene.remove(infoPanel.object);
      infoPanel.dispose();
      infoPanel = null;
    }
    if (vrConsole) { render.scene.remove(vrConsole.object); vrConsole.dispose(); vrConsole = null; }
    if (render.lab && render.lab.inVR) render.lab.exitVR();
    else render.setVRMode(false);
    if (saved) {
      render.camera.position.copy(saved.position);
      render.camera.quaternion.copy(saved.quaternion);
    }
    render.controls.enabled = true;
    render.controls.update();
    render.resize();
    refresh();
  }

  // Entrée et sortie passent par openVR (src/xr/gpuBridge.js) : la même logique pour les
  // trois voies (WebGPU directe, pont WebGPU pour émulateur, WebGL 2).
  button.addEventListener('click', async () => {
    if (session) {
      session.end();
      return;
    }
    if (!xr || !app.xr.supported) {
      toast(t('xr.fallback'));
      return;
    }
    try {
      opened = await openVR(render, { onEnd: () => { opened = null; onEnd(); } });
      session = opened.session;
      app.xr.session = session;
      app.xr.mode = opened.mode;
      onStart();
      toast(t('xr.mode.' + opened.mode));
    } catch (error) {
      session = null;
      opened = null;
      app.xr.session = null;
      toast(error.key ? t(error.key) : t('xr.failed', { message: error.message }), { kind: 'error' });
      refresh();
    }
  });

  // Un casque branché ou un émulateur activé après le chargement de la page : on revérifie.
  if (navigator.xr && navigator.xr.addEventListener) {
    navigator.xr.addEventListener('devicechange', async () => {
      app.xr.supported = await isVRSupported();
      refresh();
    });
  }

  onLangChange(refresh);
  refresh();
  return { button };
}
