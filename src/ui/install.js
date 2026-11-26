// Installation facultative de l'application (PWA).
//
// Chrome et Edge déclenchent l'évènement « beforeinstallprompt » quand le site est
// installable : on le garde de côté et on affiche notre propre bouton. Si l'utilisateur
// refuse, rien ne change : l'application reste utilisable dans le navigateur.
// Safari (iPhone, iPad) n'a pas cet évènement : on explique le geste manuel.

import { el } from './dom.js';
import { onLangChange, registerStrings, t } from './i18n.js';
import { toast } from './toast.js';

registerStrings({
  fr: {
    'install.button': 'Installer l\'application',
    'install.tip': 'Installer 3D Network Topology sur cet appareil (facultatif)',
    'install.refused': 'Installation refusée : aucun problème, l\'application reste utilisable dans le navigateur.',
    'install.done': 'Application installée. Elle fonctionne aussi hors ligne.',
    'install.ios': 'Sur iPhone ou iPad : touchez le bouton Partager de Safari puis « Sur l\'écran d\'accueil ».',
    'install.offline': 'Hors ligne',
    'install.offline.tip': 'Pas de connexion : l\'application utilise les fichiers gardés en cache.',
  },
  en: {
    'install.button': 'Install the app',
    'install.tip': 'Install 3D Network Topology on this device (optional)',
    'install.refused': 'Installation declined: no problem, the app remains usable in the browser.',
    'install.done': 'App installed. It also works offline.',
    'install.ios': 'On iPhone or iPad: tap Safari\'s Share button, then "Add to Home Screen".',
    'install.offline': 'Offline',
    'install.offline.tip': 'No connection: the app is running from cached files.',
  },
});

/** Vrai si l'application tourne déjà comme application installée. */
export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

export function initInstall(app, slot = document.getElementById('install-slot')) {
  let deferred = null; // évènement beforeinstallprompt mis de côté
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  const button = el('button', { type: 'button', class: 'btn', id: 'install-button', hidden: true });
  const offline = el('span', { class: 'offline-badge', id: 'offline-badge', hidden: true });
  slot.replaceChildren(offline, button);

  function refresh() {
    button.textContent = t('install.button');
    button.title = t('install.tip');
    offline.textContent = t('install.offline');
    offline.title = t('install.offline.tip');
    offline.hidden = navigator.onLine;
    button.hidden = isStandalone() || !(deferred || isIos);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // pas de bandeau automatique : c'est notre bouton qui propose
    deferred = event;
    refresh();
  });

  button.addEventListener('click', async () => {
    if (!deferred) {
      if (isIos) toast(t('install.ios'), { duration: 9000 });
      return;
    }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; // l'évènement ne sert qu'une fois
    if (outcome === 'dismissed') toast(t('install.refused'));
    refresh();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    toast(t('install.done'));
    refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  onLangChange(refresh);
  refresh();
}
