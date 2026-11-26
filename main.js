// Point d'entrée de l'application. FICHIER FIGÉ APRÈS LA S1 : il ne fait qu'assembler
// les quatre parties, chacune derrière une seule fonction, pour que personne n'ait
// besoin de le modifier ensuite.
//
//   simulation.js        createSimulation()   moteur, protocoles          (Khalil)
//   src/render/index.js  initRender()         scène 3D                    (Aziz)
//   src/ui/index.js      initUI()             interface HTML              (Ramy)
//   src/xr/index.js      initXR()             mode VR                     (Ayoub)

import { createSimulation } from './simulation.js';
import { initRender } from './src/render/index.js';
import { initUI } from './src/ui/index.js';
import { initXR } from './src/xr/index.js';

const SCENARIOS_DIR = 'scenarios/';

function showFatalError(error) {
  console.error(error);
  const box = document.createElement('pre');
  box.className = 'fatal-error';
  box.textContent = `Erreur au démarrage / Startup error\n\n${error && error.message ? error.message : error}`;
  document.body.appendChild(box);
}

/** Enregistre le Service Worker : il met l'application en cache pour l'usage hors ligne. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Chemin relatif : l'application fonctionne aussi sous https://<compte>.github.io/<depot>/
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('[pwa] Service Worker non enregistré :', error.message);
    });
  });
}

async function boot() {
  const sim = createSimulation();
  const render = await initRender({ container: document.getElementById('scene'), sim });

  // Le catalogue liste les scénarios disponibles et celui chargé par défaut.
  const catalog = await fetch(SCENARIOS_DIR + 'index.json').then((response) => {
    if (!response.ok) throw new Error(`Catalogue des scénarios introuvable (HTTP ${response.status})`);
    return response.json();
  });

  const app = {
    sim,
    render,
    catalog,
    /** Charge un scénario du dossier scenarios/ d'après son nom de fichier. */
    loadScenario: (file) => sim.loadScenarioFromUrl(SCENARIOS_DIR + file),
  };
  window.app = app; // pratique pour explorer depuis la console du navigateur

  initUI(app);
  initXR(app);

  // ?scenario=tcp dans l'adresse ouvre directement un scénario précis.
  const asked = new URLSearchParams(window.location.search).get('scenario');
  const wanted = asked && catalog.scenarios.find((entry) => entry.file === `${asked}.json`);
  await app.loadScenario(wanted ? wanted.file : catalog.default);

  // Boucle d'affichage : à chaque image, la simulation avance du temps réel écoulé.
  render.start((dtMs) => sim.tick(dtMs));
}

registerServiceWorker();
boot().catch(showFatalError);
