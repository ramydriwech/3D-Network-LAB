// Panneau « Technologies » : ce que cet appareil fournit à l'application, mesuré en direct.
//
// S'ouvre d'un clic sur la pastille « WebGPU » (en bas à droite de la scène), sur le bouton
// « VR indisponible », ou sur « Détails techniques » quand WebGPU manque. Sert à préparer une
// démonstration (la VR marchera-t-elle sur ce casque ?), à comprendre un problème, et à montrer
// les technologies au jury. Le contenu et la couleur de chaque ligne : techReport.mjs.

import { el } from './dom.mjs';
import { onLangChange, registerStrings, t } from './i18n.mjs';
import { toast } from './toast.mjs';
import { isStandalone } from './install.mjs';
import { techRows, reportText, valueText, gpuName, isHeadsetBrowser } from './techReport.mjs';

registerStrings({
  fr: {
    'tech.title': 'Technologies de l\'application',
    'tech.intro': 'Mesuré en direct sur cet appareil.',
    'tech.badgeTip': 'Technologies utilisées sur cet appareil (cliquer)',
    'tech.close': 'Fermer',
    'tech.copy': 'Copier le rapport',
    'tech.copied': 'Rapport copié : collez-le dans un message.',
    'tech.copyFailed': 'Copie impossible : sélectionnez le texte du panneau.',
    'tech.details': 'Détails techniques',
    'tech.loading': 'Mesure en cours…',
    'tech.row.secure': 'Contexte sécurisé (HTTPS)',
    'tech.row.render': 'Rendu 3D',
    'tech.row.gpu': 'Carte graphique',
    'tech.row.quality': 'Qualité de l\'image',
    'tech.row.webxr': 'WebXR (navigator.xr)',
    'tech.row.immersive': 'Session VR immersive',
    'tech.row.binding': 'WebXR + WebGPU (XRGPUBinding)',
    'tech.row.vr': 'VR sur cet appareil',
    'tech.row.offline': 'Hors ligne (Service Worker)',
    'tech.row.installed': 'Application installée',
    'tech.v.yes': 'oui',
    'tech.v.no': 'non',
    'tech.v.raw': '{text}',
    'tech.v.webgpu': 'WebGPU (Three.js r{revision}, WebGPURenderer), aucun contexte WebGL',
    'tech.v.noWebgpu': 'WebGPU indisponible : pas de scène 3D',
    'tech.v.unknown': 'nom non communiqué par le navigateur',
    'tech.v.quality': '{setting} → {level}',
    'tech.q.auto': 'Auto',
    'tech.q.low': 'basse',
    'tech.q.high': 'haute',
    'tech.v.detected': 'détecté',
    'tech.v.absent': 'absent',
    'tech.v.supported': 'prise en charge',
    'tech.v.noHeadset': 'aucun casque ni émulateur actif',
    'tech.v.native': 'fourni par le navigateur (VR directe)',
    'tech.v.missingBinding': 'absent : ce casque ne peut pas afficher la VR en WebGPU',
    'tech.v.bridgeOnly': 'absent : VR par le pont de l\'émulateur seulement',
    'tech.v.vrNoWebgpu': 'impossible sans WebGPU',
    'tech.v.vrNone': 'pas de casque ni d\'émulateur',
    'tech.v.vrNative': 'possible, en WebGPU directe',
    'tech.v.vrImpossible': 'impossible : il manque XRGPUBinding',
    'tech.v.vrBridge': 'possible avec l\'émulateur (pont WebGPU)',
    'tech.v.offlineReady': 'actif, application en cache : marche sans réseau',
    'tech.v.offlineSoon': 'actif, mise en cache en cours',
    'tech.v.noServiceWorker': 'pas encore actif',
    'tech.v.installed': 'oui (fenêtre de l\'application)',
    'tech.v.notInstalled': 'non (dans le navigateur)',
    'tech.tip.secure': 'Ouvrez l\'application en https:// (GitHub Pages) ou sur http://localhost : WebGPU, WebXR et le hors-ligne l\'exigent.',
    'tech.tip.webgpu': 'Utilisez Chrome ou Edge récents, Safari 26+ ou Firefox 141+ (Windows), avec l\'accélération matérielle activée.',
    'tech.tip.webxr': 'Pour la VR sur PC : Chrome ou Edge avec l\'extension Immersive Web Emulator.',
    'tech.tip.headset': 'Branchez un casque, ou activez un appareil dans l\'Immersive Web Emulator, puis rechargez la page.',
    'tech.tip.binding': 'Sur un vrai casque, activez « WebXR WebGPU » dans les réglages expérimentaux de son navigateur, puis rechargez.',
    'tech.tip.reload': 'Rechargez la page une fois avec la connexion : les fichiers seront gardés en cache.',
    'tech.tip.install': 'Bouton « Installer » de la barre du haut (facultatif).',
  },
  en: {
    'tech.title': 'App technologies',
    'tech.intro': 'Measured live on this device.',
    'tech.badgeTip': 'Technologies used on this device (click)',
    'tech.close': 'Close',
    'tech.copy': 'Copy the report',
    'tech.copied': 'Report copied: paste it into a message.',
    'tech.copyFailed': 'Cannot copy: select the panel text.',
    'tech.details': 'Technical details',
    'tech.loading': 'Measuring…',
    'tech.row.secure': 'Secure context (HTTPS)',
    'tech.row.render': '3D rendering',
    'tech.row.gpu': 'Graphics card',
    'tech.row.quality': 'Image quality',
    'tech.row.webxr': 'WebXR (navigator.xr)',
    'tech.row.immersive': 'Immersive VR session',
    'tech.row.binding': 'WebXR + WebGPU (XRGPUBinding)',
    'tech.row.vr': 'VR on this device',
    'tech.row.offline': 'Offline (Service Worker)',
    'tech.row.installed': 'App installed',
    'tech.v.yes': 'yes',
    'tech.v.no': 'no',
    'tech.v.raw': '{text}',
    'tech.v.webgpu': 'WebGPU (Three.js r{revision}, WebGPURenderer), no WebGL context',
    'tech.v.noWebgpu': 'WebGPU unavailable: no 3D scene',
    'tech.v.unknown': 'name not provided by the browser',
    'tech.v.quality': '{setting} → {level}',
    'tech.q.auto': 'Auto',
    'tech.q.low': 'low',
    'tech.q.high': 'high',
    'tech.v.detected': 'detected',
    'tech.v.absent': 'absent',
    'tech.v.supported': 'supported',
    'tech.v.noHeadset': 'no active headset or emulator',
    'tech.v.native': 'provided by the browser (direct VR)',
    'tech.v.missingBinding': 'absent: this headset cannot display VR with WebGPU',
    'tech.v.bridgeOnly': 'absent: VR through the emulator bridge only',
    'tech.v.vrNoWebgpu': 'impossible without WebGPU',
    'tech.v.vrNone': 'no headset or emulator',
    'tech.v.vrNative': 'possible, direct WebGPU',
    'tech.v.vrImpossible': 'impossible: XRGPUBinding is missing',
    'tech.v.vrBridge': 'possible with the emulator (WebGPU bridge)',
    'tech.v.offlineReady': 'active, app cached: works without network',
    'tech.v.offlineSoon': 'active, caching in progress',
    'tech.v.noServiceWorker': 'not active yet',
    'tech.v.installed': 'yes (app window)',
    'tech.v.notInstalled': 'no (in the browser)',
    'tech.tip.secure': 'Open the app over https:// (GitHub Pages) or on http://localhost: WebGPU, WebXR and offline mode require it.',
    'tech.tip.webgpu': 'Use a recent Chrome or Edge, Safari 26+ or Firefox 141+ (Windows), with hardware acceleration enabled.',
    'tech.tip.webxr': 'For VR on a PC: Chrome or Edge with the Immersive Web Emulator extension.',
    'tech.tip.headset': 'Connect a headset, or enable a device in the Immersive Web Emulator, then reload the page.',
    'tech.tip.binding': 'On a real headset, enable "WebXR WebGPU" in its browser\'s experimental settings, then reload.',
    'tech.tip.reload': 'Reload the page once while online: the files will be cached.',
    'tech.tip.install': '"Install" button in the top bar (optional).',
  },
});

/** Ce que l'appareil fournit, mesuré maintenant. */
async function measure(app) {
  const render = app.render || {};
  const facts = {
    secure: !!window.isSecureContext,
    backend: render.backend,
    threeRevision: window.__THREE__ || '',
    gpu: '',
    quality: render.backend === 'webgpu' && render.quality ? { setting: render.quality.setting, level: render.quality.level } : null,
    xr: !!navigator.xr,
    immersiveVR: false,
    xrgpuBinding: typeof globalThis.XRGPUBinding !== 'undefined',
    headset: isHeadsetBrowser(navigator.userAgent),
    serviceWorker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    cached: false,
    standalone: isStandalone(),
  };
  const tasks = [];
  if (render.backend === 'webgpu' && navigator.gpu) {
    tasks.push(navigator.gpu.requestAdapter().then((adapter) => { facts.gpu = adapter ? gpuName(adapter.info) : ''; }).catch(() => {}));
  }
  if (navigator.xr && navigator.xr.isSessionSupported && facts.secure) {
    tasks.push(navigator.xr.isSessionSupported('immersive-vr').then((ok) => { facts.immersiveVR = !!ok; }).catch(() => {}));
  }
  if (facts.serviceWorker && window.caches) {
    tasks.push(caches.keys().then((keys) => { facts.cached = keys.length > 0; }).catch(() => {}));
  }
  await Promise.all(tasks);
  return facts;
}

export function initTechPanel(app) {
  const sceneBox = document.getElementById('scene');
  if (!sceneBox) return null;
  let rows = [];
  let open = false;

  const title = el('h2', {}, t('tech.title'));
  const intro = el('p', { class: 'tech-intro' }, t('tech.intro'));
  const closeButton = el('button', { type: 'button', class: 'btn tech-close', 'aria-label': t('tech.close'), title: t('tech.close'), onclick: () => hide() }, '×');
  const list = el('dl', { class: 'tech-list' });
  const copyButton = el('button', { type: 'button', class: 'btn', onclick: () => copy() }, t('tech.copy'));
  const panel = el('div', { class: 'tech-panel', id: 'tech-panel', role: 'dialog', 'aria-labelledby': 'tech-title', hidden: true },
    el('div', { class: 'tech-head' }, title, closeButton), intro, list, el('div', { class: 'tech-foot' }, copyButton));
  title.id = 'tech-title';
  sceneBox.append(panel);

  function paint() {
    title.textContent = t('tech.title');
    intro.textContent = t('tech.intro');
    closeButton.title = t('tech.close');
    closeButton.setAttribute('aria-label', t('tech.close'));
    copyButton.textContent = t('tech.copy');
    if (!rows.length) { list.replaceChildren(el('dd', {}, t('tech.loading'))); return; }
    list.replaceChildren(...rows.flatMap((item) => [
      el('dt', {}, t(`tech.row.${item.id}`)),
      el('dd', { class: `tech-${item.level}`, 'data-row': item.id },
        valueText(item, t),
        item.tip ? el('small', {}, t(item.tip)) : null),
    ]));
  }

  async function show() {
    open = true;
    rows = [];
    panel.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    paint();
    rows = techRows(await measure(app));
    if (open) paint();
  }
  function hide() { open = false; panel.hidden = true; }
  function toggle() { if (open) hide(); else show(); }

  async function copy() {
    const header = `${t('tech.title')} — ${new Date().toLocaleString()} — ${navigator.userAgent}`;
    try {
      await navigator.clipboard.writeText(reportText(rows, t, header));
      toast(t('tech.copied'));
    } catch {
      toast(t('tech.copyFailed'), { kind: 'error' });
    }
  }

  // Points d'entrée : la pastille « WebGPU » de la scène, et « Détails techniques » sous le
  // message affiché quand WebGPU manque (le bouton « VR indisponible » appelle open(), src/xr/session.mjs).
  const badge = sceneBox.querySelector('.backend-badge');
  if (badge) {
    badge.classList.add('is-clickable');
    badge.setAttribute('role', 'button');
    badge.tabIndex = 0;
    badge.title = t('tech.badgeTip');
    badge.addEventListener('click', toggle);
    badge.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
  }
  const failure = sceneBox.querySelector('.scene-error');
  let detailsButton = null;
  if (failure) {
    detailsButton = el('button', { type: 'button', class: 'btn', onclick: () => show() }, t('tech.details'));
    failure.append(el('p', {}, detailsButton));
  }

  window.addEventListener('keydown', (event) => { if (open && event.key === 'Escape') hide(); });
  onLangChange(() => {
    if (badge) badge.title = t('tech.badgeTip');
    if (detailsButton) detailsButton.textContent = t('tech.details');
    paint();
  });

  return { open: show, close: hide, toggle, get isOpen() { return open; } };
}
