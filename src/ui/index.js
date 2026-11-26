// Démarrage de l'interface : ce fichier lance tous les modules, chacun dans la zone de
// index.html qui lui est réservée. Un module = un fichier = une zone.
//
//   #lang-slot      bouton FR/EN           i18n.js
//   #controls       commandes              controls.js
//   #info           équipement sélectionné infoPanel.js (+ selection.js pour le clic)
//   #explanations   explications           explanations.js
//   #inspector      champs d'un paquet     inspector.js
//   #journal        messages échangés      journal.js
//   #scenario-slot  choix du scénario      scenarioPicker.js
//   #install-slot   installation PWA       install.js
//   #xr-slot        bouton VR              réservé à src/xr/
//   #scene (coin)   légende des paquets    packetLegend.js (protocoles du scénario, formes)

import { applyI18n, createLangToggle, registerStrings } from './i18n.js';
import { initControls } from './controls.js';
import { initSelection } from './selection.js';
import { initInfoPanel } from './infoPanel.js';
import { initExplanations } from './explanations.js';
import { initInspector } from './inspector.js';
import { initJournal } from './journal.js';
import { initScenarioPicker } from './scenarioPicker.js';
import { initInstall } from './install.js';
import { initTabs } from './tabs.js';
import { initDiagnosticPanel } from './diagnosticPanel.js';
import { initEditorPanel } from './editorPanel.js';
import { createTerminals } from './terminal.js';
import { initLabHud } from './labHud.js';
import { initMissions } from './missions.js';
import { initPacketLegend } from './packetLegend.js';

registerStrings({
  fr: {
    'app.title': '3D Network Topology',
    'scene.hint': 'Glisser : tourner · Molette ou pincement : zoomer · Clic droit ou deux doigts : déplacer',
    'scene.label': 'Scène 3D de la topologie réseau',
  },
  en: {
    'app.title': '3D Network Topology',
    'scene.hint': 'Drag: rotate · Wheel or pinch: zoom · Right-click or two fingers: pan',
    'scene.label': '3D scene of the network topology',
  },
});

/**
 * @param {Object} app  { sim, render, catalog, loadScenario(file) } fourni par main.js
 */
export function initUI(app) {
  createLangToggle(document.getElementById('lang-slot'));
  app.tabs = initTabs(app);

  initSelection(app);
  initControls(app);
  initInfoPanel(app);
  initExplanations(app);
  initInspector(app);
  initJournal(app);
  app.packetLegend = initPacketLegend(app);
  initScenarioPicker(app);
  initInstall(app);
  app.diagnostic = initDiagnosticPanel(app);
  app.terminals = createTerminals(app);
  app.editor = initEditorPanel(app);
  app.missions = initMissions(app);
  app.labHud = initLabHud(app);

  applyI18n(document);
}
