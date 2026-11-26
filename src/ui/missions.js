// Onglet « Missions » (S7) : les exercices guidés du laboratoire (src/sim/missions.js).
//
// Choisir une mission charge sa situation de départ (souvent une panne), ouvre le
// laboratoire et affiche l'énoncé, les objectifs (cochés automatiquement dès qu'ils sont
// atteints, par la console, l'éditeur ou un échange réussi), trois indices de plus en plus
// précis et, une fois la mission réussie, l'explication « Pourquoi ? ».

import { Topics } from '../sim/events.js';
import { MISSIONS, createPingTracker, evaluateMission, missionScenario } from '../sim/missions.js';
import { el } from './dom.js';
import { localize, onLangChange, registerStrings, t } from './i18n.js';
import { toast } from './toast.js';

registerStrings({
  fr: {
    'mis.tab': 'Missions', 'mis.title': 'Missions du laboratoire',
    'mis.intro': 'Des exercices guidés : chaque mission installe une situation dans le labo. Réparez-la à la console, les objectifs se cochent tout seuls.',
    'mis.level': 'Niveau {n}', 'mis.start': 'Commencer', 'mis.restart': 'Recommencer', 'mis.leave': 'Toutes les missions',
    'mis.hint': 'Indice ({n}/3)', 'mis.noHint': 'Plus d\'indice : vous avez tout !', 'mis.why': 'Pourquoi ?',
    'mis.done': 'Mission réussie : {title}', 'mis.progress': '{n}/{total} objectifs', 'mis.success': 'Bravo, mission réussie !',
  },
  en: {
    'mis.tab': 'Missions', 'mis.title': 'Lab missions',
    'mis.intro': 'Guided exercises: each mission sets up a situation in the lab. Fix it at the console; the objectives tick themselves.',
    'mis.level': 'Level {n}', 'mis.start': 'Start', 'mis.restart': 'Restart', 'mis.leave': 'All missions',
    'mis.hint': 'Hint ({n}/3)', 'mis.noHint': 'No more hints: you have them all!', 'mis.why': 'Why?',
    'mis.done': 'Mission complete: {title}', 'mis.progress': '{n}/{total} objectives', 'mis.success': 'Well done, mission complete!',
  },
});

const DONE_KEY = 'ntopo.missions.done';
const readDone = () => { try { return new Set(JSON.parse(window.localStorage.getItem(DONE_KEY) || '[]')); } catch { return new Set(); } };
const writeDone = (set) => { try { window.localStorage.setItem(DONE_KEY, JSON.stringify([...set])); } catch { /* stockage refusé */ } };

export function initMissions(app, slot = document.getElementById('missions')) {
  if (!slot) return null;
  const { sim } = app;
  const tracker = createPingTracker(sim, Topics);
  const done = readDone();
  let current = null; // { mission, hints, result, scenarioId }
  let checking = 0;

  const ctx = {
    get scenario() { return sim.scenario; },
    history: (id) => { const s = app.terminals && app.terminals.session(id); return s ? s.con.history() : []; },
    pinged: tracker.pinged,
  };

  async function start(mission) {
    tracker.reset();
    if (app.terminals) for (const id of [...app.terminals.sessions.keys()]) app.terminals.close(id);
    if (app.editor && app.editor.active) await app.editor.quit();
    const scenario = await missionScenario(mission, (file) => fetch(`scenarios/${file}`).then((r) => r.json()));
    current = { mission, hints: 0, result: null, scenarioId: scenario.id };
    // La mission « de zéro » se construit dans l'éditeur ; les autres se jouent sur leur scénario.
    if (!mission.base && app.editor) app.editor.start(scenario);
    else await sim.loadScenario(scenario);
    if (app.render && app.render.lab && !app.render.lab.active) app.render.lab.enter();
    tracker.reset();
    paint();
  }

  function check() {
    if (!current) return;
    const before = current.result;
    current.result = evaluateMission(current.mission, ctx);
    if (current.result.complete && !(before && before.complete)) {
      done.add(current.mission.id);
      writeDone(done);
      toast(t('mis.done', { title: localize(current.mission.title) }), { kind: 'success' });
    }
    if (!before || before.score !== current.result.score || before.complete !== current.result.complete) paint();
  }
  // Vérification régulière et après chaque évènement utile (sans recalculer à chaque paquet).
  const soon = () => { clearTimeout(checking); checking = setTimeout(check, 120); };
  sim.on(Topics.SCENARIO_LOADED, soon);
  sim.on(Topics.FINISHED, soon);
  sim.on(Topics.PACKET_RECEIVE, (event) => { if (current && event.packet && event.packet.icmp) soon(); });
  if (app.terminals) app.terminals.onChange(soon);

  function listView() {
    return [
      el('p', { class: 'muted small' }, t('mis.intro')),
      el('ol', { class: 'mis-list' }, MISSIONS.map((mission) => el('li', { class: done.has(mission.id) ? 'mis-done' : '' },
        el('div', {},
          el('strong', {}, localize(mission.title)),
          el('span', { class: 'tag mis-level' }, t('mis.level', { n: mission.level })),
          done.has(mission.id) ? el('span', { class: 'mis-check', 'aria-label': 'ok' }, ' ✔') : null),
        el('p', { class: 'small muted' }, localize(mission.brief)),
        el('button', { type: 'button', class: 'btn btn-primary', id: `mis-start-${mission.id}`, onclick: () => start(mission) }, t('mis.start'))))),
    ];
  }

  function missionView() {
    const { mission, hints, result } = current;
    const states = result ? result.done : mission.tasks.map(() => false);
    const parts = [
      el('h3', { class: 'sub-title' }, localize(mission.title)),
      el('p', {}, localize(mission.brief)),
      el('p', { class: 'muted small' }, t('mis.progress', { n: states.filter(Boolean).length, total: states.length })),
      el('ul', { class: 'mis-tasks' }, mission.tasks.map((task, i) => el('li', { class: states[i] ? 'ok' : '' }, el('span', { class: 'mis-box' }, states[i] ? '✔' : ''), localize(task.text)))),
    ];
    for (let i = 0; i < hints; i += 1) parts.push(el('p', { class: 'mis-hint' }, `💡 ${localize(mission.hints[i])}`));
    if (result && result.complete) {
      parts.push(el('p', { class: 'mis-success' }, t('mis.success')));
      parts.push(el('details', { class: 'mis-why', open: true }, el('summary', {}, t('mis.why')), el('p', {}, localize(mission.why))));
    } else {
      parts.push(el('details', { class: 'mis-why' }, el('summary', {}, t('mis.why')), el('p', {}, localize(mission.why))));
    }
    parts.push(el('div', { class: 'ed-row' },
      el('button', { type: 'button', class: 'btn', id: 'mis-hint', disabled: hints >= mission.hints.length, onclick: () => { current.hints += 1; paint(); } },
        hints >= mission.hints.length ? t('mis.noHint') : t('mis.hint', { n: hints + 1 })),
      el('button', { type: 'button', class: 'btn', onclick: () => start(mission) }, t('mis.restart')),
      el('button', { type: 'button', class: 'btn', onclick: () => { current = null; paint(); } }, t('mis.leave'))));
    return parts;
  }

  function paint() {
    slot.replaceChildren(el('h2', { class: 'panel-title' }, t('mis.title')), ...(current ? missionView() : listView()));
    if (app.tabs) app.tabs.badge('missions', current && current.result && !current.result.complete ? `${current.result.score}/${current.mission.tasks.length}` : '');
  }

  if (app.tabs) app.tabs.add({ id: 'missions', label: 'mis.tab', panels: ['missions'] });
  onLangChange(paint);
  paint();
  return {
    open() { if (app.tabs) app.tabs.select('missions'); },
    start: (id) => start(MISSIONS.find((m) => m.id === id)),
    get current() { return current; },
    check,
  };
}
