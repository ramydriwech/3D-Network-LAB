// Point d'entrée de l'application. Il ne fait qu'assembler les quatre modules, chacun
// derrière une seule fonction : ajouter une fonctionnalité ne demande pas de le modifier.
//
//   simulation.mjs        createSimulation()   moteur, protocoles
//   src/render/index.mjs  initRender()         scène 3D
//   src/ui/index.mjs      initUI()             interface HTML
//   src/xr/index.mjs      initXR()             mode VR

import { createSimulation } from './simulation.mjs';
import { initRender } from './src/render/index.mjs';
import { initUI } from './src/ui/index.mjs';
import { initXR } from './src/xr/index.mjs';

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
    navigator.serviceWorker.register('sw.mjs').catch((error) => {
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
