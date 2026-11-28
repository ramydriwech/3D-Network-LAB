// Installation facultative de l'application (PWA) : le bouton « Installer » de la barre du haut.
//
// Le bouton est toujours là, sauf quand l'application tourne déjà comme application installée.
//   - Chrome et Edge envoient l'évènement « beforeinstallprompt » quand le site est
//     installable : on le garde de côté, et un clic sur le bouton ouvre leur fenêtre
//     d'installation.
//   - Sinon (Safari, Firefox, iPhone, ou Chrome qui ne l'a pas encore proposé), un clic
//     explique le geste à faire sur ce navigateur (installHelp.mjs).
// Si l'utilisateur refuse, rien ne change : l'application reste utilisable dans le navigateur.
//
// L'évènement est écouté dès le chargement de ce module, avant le démarrage de la scène 3D
// (WebGPU, modèles, laboratoire : une ou deux secondes) : sinon il pourrait arriver avant que
// le bouton existe, et serait perdu.

import { el } from './dom.mjs';
import { onLangChange, registerStrings, t } from './i18n.mjs';
import { toast } from './toast.mjs';
import { installHelpKey } from './installHelp.mjs';

registerStrings({
  fr: {
    'install.button': 'Installer',
    'install.tip': 'Installer 3D Network LAB sur cet appareil : elle s\'ouvre dans sa propre fenêtre et fonctionne hors ligne (facultatif)',
    'install.refused': 'Installation refusée : aucun problème, l\'application reste utilisable dans le navigateur.',
    'install.done': 'Application installée. Elle fonctionne aussi hors ligne.',
    'install.ios': 'Sur iPhone ou iPad : touchez le bouton Partager de Safari puis « Sur l\'écran d\'accueil ».',
    'install.help.chrome': 'Pour installer : cliquez sur l\'icône d\'installation à droite de la barre d\'adresse, ou, dans le menu ⋮ de Chrome, sur « Installer… » (rubrique « Caster, enregistrer et partager »). Si l\'application est déjà installée, ouvrez-la depuis le menu Démarrer ou le bureau.',
    'install.help.edge': 'Pour installer : menu ⋯ d\'Edge → « Applications » → « Installer ce site en tant qu\'application ». Si l\'application est déjà installée, ouvrez-la depuis le menu Démarrer.',
    'install.help.safari': 'Sur Mac : menu Fichier de Safari → « Ajouter au Dock ».',
    'install.help.android': 'Sur Android : menu ⋮ du navigateur → « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».',
    'install.help.firefox': 'Firefox ne sait pas installer les applications web sur ordinateur : ouvrez la page dans Chrome, Edge ou Safari pour l\'installer. Elle reste utilisable ici, dans le navigateur.',
    'install.offline': 'Hors ligne',
    'install.offline.tip': 'Pas de connexion : l\'application utilise les fichiers gardés en cache.',
  },
  en: {
    'install.button': 'Install',
    'install.tip': 'Install 3D Network LAB on this device: it opens in its own window and works offline (optional)',
    'install.refused': 'Installation declined: no problem, the app remains usable in the browser.',
    'install.done': 'App installed. It also works offline.',
    'install.ios': 'On iPhone or iPad: tap Safari\'s Share button, then "Add to Home Screen".',
    'install.help.chrome': 'To install: click the install icon on the right of the address bar, or, in Chrome\'s ⋮ menu, "Install…" (under "Cast, save and share"). If the app is already installed, open it from the Start menu or the desktop.',
    'install.help.edge': 'To install: Edge\'s ⋯ menu → "Apps" → "Install this site as an app". If the app is already installed, open it from the Start menu.',
    'install.help.safari': 'On a Mac: Safari\'s File menu → "Add to Dock".',
    'install.help.android': 'On Android: the browser\'s ⋮ menu → "Install app" or "Add to Home screen".',
    'install.help.firefox': 'Firefox cannot install web apps on a computer: open the page in Chrome, Edge or Safari to install it. It remains usable here, in the browser.',
    'install.offline': 'Offline',
    'install.offline.tip': 'No connection: the app is running from cached files.',
  },
});

// ------------------------------------------------- écoute dès le chargement du module
let deferred = null; // évènement beforeinstallprompt mis de côté
let installed = false;
const watchers = new Set();
const notify = () => { for (const fn of watchers) fn(); };
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // pas de bandeau automatique : c'est notre bouton qui propose
    deferred = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Vrai si l'application tourne déjà comme application installée. */
export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

export function initInstall(app, slot = document.getElementById('install-slot')) {
  const help = installHelpKey(navigator.userAgent, { touchPoints: navigator.maxTouchPoints || 0 });

  const button = el('button', { type: 'button', class: 'btn install-button', id: 'install-button' });
  const offline = el('span', { class: 'offline-badge', id: 'offline-badge', hidden: true });
  slot.replaceChildren(offline, button);

  function refresh() {
    button.textContent = t('install.button');
    button.title = t('install.tip');
    button.classList.toggle('btn-primary', !!deferred); // installation en un clic possible
    offline.textContent = t('install.offline');
    offline.title = t('install.offline.tip');
    offline.hidden = navigator.onLine;
    button.hidden = installed || isStandalone();
  }

  button.addEventListener('click', async () => {
    if (!deferred) {
      toast(t(help === 'ios' ? 'install.ios' : `install.help.${help}`), { duration: 12000 });
      return;
    }
    const prompt = deferred;
    deferred = null; // l'évènement ne sert qu'une fois
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'dismissed') toast(t('install.refused'));
    refresh();
  });

  watchers.add(() => {
    if (installed) toast(t('install.done'));
    refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  onLangChange(refresh);
  refresh();
}
