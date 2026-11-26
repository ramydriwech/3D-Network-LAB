// Démarrage de l'interface : ce fichier lance tous les modules, chacun dans la zone de
// index.html qui lui est réservée. Un module = un fichier = une zone.
//
//   #lang-slot      bouton FR/EN           i18n.mjs
//   #controls       commandes              controls.mjs
//   #info           équipement sélectionné infoPanel.mjs (+ selection.mjs pour le clic)
//   #explanations   explications           explanations.mjs
//   #inspector      champs d'un paquet     inspector.mjs
//   #journal        messages échangés      journal.mjs
//   #scenario-slot  choix du scénario      scenarioPicker.mjs
//   #install-slot   installation PWA       install.mjs
//   #xr-slot        bouton VR              réservé à src/xr/
//   #scene (coin)   légende des paquets    packetLegend.mjs (protocoles du scénario, formes)

import { applyI18n, createLangToggle, registerStrings } from './i18n.mjs';
import { initControls } from './controls.mjs';
import { initSelection } from './selection.mjs';
import { initInfoPanel } from './infoPanel.mjs';
import { initExplanations } from './explanations.mjs';
import { initInspector } from './inspector.mjs';
import { initJournal } from './journal.mjs';
import { initScenarioPicker } from './scenarioPicker.mjs';
import { initInstall } from './install.mjs';
import { initTabs } from './tabs.mjs';
import { initDiagnosticPanel } from './diagnosticPanel.mjs';
import { initEditorPanel } from './editorPanel.mjs';
import { createTerminals } from './terminal.mjs';
import { initLabHud } from './labHud.mjs';
import { initMissions } from './missions.mjs';
import { initPacketLegend } from './packetLegend.mjs';
import { initTechPanel } from './techPanel.mjs';

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
 * @param {Object} app  { sim, render, catalog, loadScenario(file) } fourni par main.mjs
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
  app.techPanel = initTechPanel(app); // pastille « WebGPU » : technologies mesurées sur l'appareil
  app.diagnostic = initDiagnosticPanel(app);
  app.terminals = createTerminals(app);
  app.editor = initEditorPanel(app);
  app.missions = initMissions(app);
  app.labHud = initLabHud(app);

  applyI18n(document);
}
