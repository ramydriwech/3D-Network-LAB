// Explications pédagogiques : présentation du scénario, étape en cours et, pour chaque
// instant de la simulation, ce que font les équipements et pourquoi.

import { Topics } from '../sim/events.js';
import { el } from './dom.js';
import { formatNote, getLang, localize, onLangChange, registerStrings, t } from './i18n.js';

registerStrings({
  fr: {
    'exp.objectives': 'À observer',
    'exp.step': 'Étape',
    'exp.now': 'Ce qui se passe',
    'exp.start': 'Appuyez sur Lecture ou sur Pas à pas pour démarrer.',
    'exp.finished': 'Scénario terminé. Réinitialisez pour le rejouer, ou choisissez-en un autre.',
    'exp.custom': 'Action lancée à la main',
    'exp.custom.ping': 'Ping de {from} vers {to}, sur un réseau remis à zéro (caches ARP et tables MAC vides).',
    'exp.restore': 'Revenir au scénario',
    'exp.dropped': 'Paquet détruit',
  },
  en: {
    'exp.objectives': 'What to look for',
    'exp.step': 'Step',
    'exp.now': 'What is happening',
    'exp.start': 'Press Play or Step to start.',
    'exp.finished': 'Scenario finished. Reset to replay it, or pick another one.',
    'exp.custom': 'Manually started action',
    'exp.custom.ping': 'Ping from {from} to {to}, on a freshly reset network (empty ARP caches and MAC tables).',
    'exp.restore': 'Back to the scenario',
    'exp.dropped': 'Packet discarded',
  },
});

export function initExplanations(app, slot = document.getElementById('explanations')) {
  const { sim } = app;
  let step = null;        // étape de scénario en cours
  let entries = [];       // explications de l'instant affiché : { note, kind }
  let lastArrival = null; // date de la dernière réception affichée
  let finished = false;

  function draw() {
    const scenario = sim.scenario;
    if (!scenario) return;
    const children = [
      el('h2', { class: 'panel-title' }, localize(scenario.title)),
      el('p', { class: 'summary' }, localize(scenario.summary)),
    ];
    const objectives = scenario.objectives && (scenario.objectives[getLang()] || scenario.objectives.fr);
    if (objectives && objectives.length) {
      children.push(el('details', { class: 'objectives' },
        el('summary', {}, t('exp.objectives')),
        el('ul', {}, objectives.map((line) => el('li', {}, line)))));
    }

    if (sim.isCustom && sim.isCustom()) {
      const action = sim.steps()[0];
      const name = (id) => (sim.device(id) ? sim.device(id).name : id);
      children.push(el('div', { class: 'step-box custom' },
        el('h3', { class: 'sub-title' }, t('exp.custom')),
        el('p', {}, t('exp.custom.' + action.action, { from: name(action.from), to: name(action.to) })),
        el('button', { type: 'button', class: 'btn', onclick: () => sim.restoreScenario() }, t('exp.restore'))));
    } else if (step && (step.title || step.explanation)) {
      children.push(el('div', { class: 'step-box' },
        el('h3', { class: 'sub-title' }, localize(step.title) || t('exp.step')),
        step.explanation ? el('p', {}, localize(step.explanation)) : null));
    }

    const live = el('div', { class: 'live', 'aria-live': 'polite' }, el('h3', { class: 'sub-title' }, t('exp.now')));
    if (!entries.length && !finished) live.append(el('p', { class: 'muted' }, t('exp.start')));
    const seen = new Set();
    for (const entry of entries) {
      const text = formatNote(sim, entry.note);
      if (seen.has(text)) continue; // une diffusion recopiée sur trois câbles = une seule explication
      seen.add(text);
      live.append(el('p', { class: 'note note-' + entry.kind },
        entry.kind === 'drop' ? el('strong', {}, t('exp.dropped') + ' — ') : null, text));
    }
    if (finished) live.append(el('p', { class: 'note note-done' }, t('exp.finished')));
    children.push(live);
    slot.replaceChildren(...children);
  }

  /**
   * Regroupe les explications par « instant » : un départ de paquet qui suit une arrivée
   * plus ancienne commence un nouvel instant et efface l'ancien.
   */
  function add(event, kind) {
    if (kind !== 'receive' && lastArrival !== null && event.time > lastArrival) {
      entries = [];
      lastArrival = null;
    }
    if (kind === 'receive') lastArrival = event.time;
    for (const note of event.notes || []) entries.push({ note, kind });
    draw();
  }

  sim.on(Topics.PACKET_SEND, (event) => add(event, 'send'));
  sim.on(Topics.PACKET_RECEIVE, (event) => add(event, 'receive'));
  sim.on(Topics.PACKET_DROP, (event) => add(event, 'drop'));
  sim.on(Topics.NOTE, (event) => add(event, 'info'));
  sim.on(Topics.STEP, (event) => { step = event.step; entries = []; lastArrival = null; draw(); });
  sim.on(Topics.FINISHED, () => { finished = true; draw(); });
  sim.on(Topics.RESET, () => { step = null; entries = []; lastArrival = null; finished = false; draw(); });
  sim.on(Topics.SCENARIO_LOADED, draw);
  onLangChange(draw);
  draw();
}
