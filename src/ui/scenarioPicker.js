// Liste de choix du scénario. Les scénarios disponibles sont décrits dans
// scenarios/index.json (le catalogue), chargé au démarrage par main.js.

import { Topics } from '../sim/events.js';
import { el } from './dom.js';
import { localize, onLangChange, registerStrings, t } from './i18n.js';
import { toast } from './toast.js';

registerStrings({
  fr: { 'picker.label': 'Scénario', 'picker.error': 'Impossible de charger ce scénario : {message}' },
  en: { 'picker.label': 'Scenario', 'picker.error': 'Could not load this scenario: {message}' },
});

export function initScenarioPicker(app, slot = document.getElementById('scenario-slot')) {
  const entries = (app.catalog && app.catalog.scenarios) || [];
  const select = el('select', { id: 'scenario-select' });
  const label = el('label', { class: 'picker', for: 'scenario-select' }, el('span', { 'data-i18n': 'picker.label' }, t('picker.label')), select);
  let loaded = null; // fichier du scénario affiché

  function draw() {
    select.replaceChildren(...entries.map((entry) => el('option', { value: entry.file }, localize(entry.title))));
    if (loaded) select.value = loaded;
  }

  select.addEventListener('change', async () => {
    const file = select.value;
    select.disabled = true;
    try {
      await app.loadScenario(file);
    } catch (error) {
      toast(t('picker.error', { message: error.message }), { kind: 'error' });
      if (loaded) select.value = loaded; // on reste sur le scénario précédent
    } finally {
      select.disabled = false;
    }
  });

  // Un réseau qui ne vient pas du catalogue (éditeur, import) apparaît comme une entrée à part.
  let custom = null;
  app.sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => {
    const entry = entries.find((item) => item.file === `${scenario.id}.json`);
    if (custom) { custom.remove(); custom = null; }
    if (entry) {
      loaded = entry.file;
      select.value = loaded;
    } else {
      custom = el('option', { value: '', disabled: true }, `✎ ${localize(scenario.title)}`);
      select.prepend(custom);
      select.value = '';
      loaded = null;
    }
  });
  onLangChange(draw);
  draw();
  if (app.sim.scenario) {
    loaded = `${app.sim.scenario.id}.json`;
    select.value = loaded;
  }
  slot.replaceChildren(label);
}
