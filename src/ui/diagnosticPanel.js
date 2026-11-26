// Onglet « Diagnostic » : constats du moteur de diagnostic (src/sim/diagnostic.js) et
// corrections en un clic (demande du superviseur).
//
// Pour chaque constat : gravité, titre, cause, conseil ; « Montrer » surligne les
// équipements et câbles concernés ; « Corriger » applique la correction à une copie du
// scénario et la recharge. On peut revenir au scénario d'origine à tout moment.
// Pendant la lecture, le diagnostic tient aussi compte du trafic (liens saturés, pertes).

import { Topics } from '../sim/events.js';
import { applyFix, describeFix, diagnose } from '../sim/diagnostic.js';
import { el, panelTitle } from './dom.js';
import { applyI18n, localize, onLangChange, registerStrings, t } from './i18n.js';

registerStrings({
  fr: {
    'diag.tab': 'Diagnostic',
    'diag.title': 'Diagnostic du réseau',
    'diag.intro': 'Le simulateur vérifie l\'adressage, les passerelles, les routes, le câblage et, pendant la lecture, la charge des liens.',
    'diag.counts': '{error} erreur(s) · {warning} avertissement(s) · {info} remarque(s)',
    'diag.healthy': 'Réseau sain',
    'diag.error': 'Erreur', 'diag.warning': 'Avertissement', 'diag.info': 'Remarque',
    'diag.why': 'Pourquoi', 'diag.how': 'Que faire',
    'diag.show': 'Montrer', 'diag.fix': 'Corriger : {what}',
    'diag.fixAll': 'Tout corriger ({n})',
    'diag.modified': 'Scénario modifié : {n} correction(s) appliquée(s).',
    'diag.restore': 'Revenir au scénario d\'origine',
    'diag.none': 'Chargez un scénario pour lancer le diagnostic.',
  },
  en: {
    'diag.tab': 'Diagnostic',
    'diag.title': 'Network diagnostic',
    'diag.intro': 'The simulator checks addressing, gateways, routes, cabling and, during playback, link load.',
    'diag.counts': '{error} error(s) · {warning} warning(s) · {info} note(s)',
    'diag.healthy': 'Healthy network',
    'diag.error': 'Error', 'diag.warning': 'Warning', 'diag.info': 'Note',
    'diag.why': 'Why', 'diag.how': 'What to do',
    'diag.show': 'Show', 'diag.fix': 'Fix: {what}',
    'diag.fixAll': 'Fix everything ({n})',
    'diag.modified': 'Modified scenario: {n} fix(es) applied.',
    'diag.restore': 'Back to the original scenario',
    'diag.none': 'Load a scenario to run the diagnostic.',
  },
});

/** Intervalle de réévaluation pendant la lecture (ms réelles). */
const LIVE_REFRESH = 1000;

export function initDiagnosticPanel(app, slot = document.getElementById('diagnostic')) {
  const { sim, render } = app;
  let report = null;
  let signature = '';
  let original = null; // scénario avant les corrections
  let applied = 0;
  let loadingFix = false;

  function run() {
    if (!sim.scenario) { report = null; return; }
    report = diagnose(sim.scenario, { traffic: sim.state === 'ready' ? null : sim.traffic && sim.traffic() });
  }

  function show(item) {
    render.highlight(item.devices);
    if (render.linkLoad && render.linkLoad.flash) render.linkLoad.flash(item.links);
    sim.bus.emit(Topics.SELECT, { kind: null });
    render.highlight(item.devices); // la désélection a effacé les anneaux : on les remet
  }

  async function fix(...fixes) {
    if (!original) original = sim.scenario;
    let scenario = sim.scenario;
    for (const item of fixes) scenario = applyFix(scenario, item);
    loadingFix = true;
    try {
      await sim.loadScenario(scenario);
      applied += fixes.length;
    } finally {
      loadingFix = false;
    }
    paint();
  }

  /** Corrige tant qu'il reste des corrections automatiques (une correction peut en révéler une autre). */
  function fixAll() {
    let scenario = sim.scenario;
    const fixes = [];
    for (let round = 0; round < 20; round++) {
      const next = diagnose(scenario).findings.find((item) => item.fix);
      if (!next) break;
      fixes.push(next.fix);
      scenario = applyFix(scenario, next.fix);
    }
    if (fixes.length) fix(...fixes);
  }

  async function restore() {
    const back = original;
    original = null;
    applied = 0;
    if (back) await sim.loadScenario(back);
    paint();
  }

  function card(item) {
    return el('article', { class: `finding finding-${item.severity}` },
      el('header', {},
        el('span', { class: `sev sev-${item.severity}` }, t('diag.' + item.severity)),
        el('h3', {}, localize(item.title))),
      item.rule === 'summary' ? null : el('p', {}, el('strong', {}, t('diag.why') + ' — '), localize(item.cause)),
      el('p', {}, el('strong', {}, t('diag.how') + ' — '), localize(item.advice)),
      el('div', { class: 'finding-actions' },
        item.devices.length || item.links.length
          ? el('button', { type: 'button', class: 'btn', onclick: () => show(item) }, t('diag.show'))
          : null,
        item.fix
          ? el('button', { type: 'button', class: 'btn btn-primary', onclick: () => fix(item.fix) }, t('diag.fix', { what: localize(describeFix(item.fix)) }))
          : null));
  }

  function paint() {
    run();
    if (!report) {
      slot.replaceChildren(panelTitle('diag.title'), el('p', { class: 'muted', 'data-i18n': 'diag.none' }));
      applyI18n(slot);
      if (app.tabs) app.tabs.badge('diagnostic', 0);
      return;
    }
    signature = report.findings.map((item) => item.id).join('|');
    const fixable = report.findings.filter((item) => item.fix).length;
    const children = [
      el('h2', { class: 'panel-title' }, t('diag.title')),
      el('p', { class: 'muted small' }, t('diag.intro')),
      el('p', { class: `diag-summary ${report.healthy ? 'ok' : report.counts.error ? 'bad' : 'warn'}` },
        report.healthy ? el('strong', {}, t('diag.healthy') + ' · ') : null,
        t('diag.counts', report.counts)),
    ];
    if (original) {
      children.push(el('p', { class: 'diag-modified small' }, t('diag.modified', { n: applied }), ' ',
        el('button', { type: 'button', class: 'btn btn-link', onclick: restore }, t('diag.restore'))));
    }
    if (fixable > 1) children.push(el('button', { type: 'button', class: 'btn btn-primary btn-wide', id: 'diag-fix-all', onclick: fixAll }, t('diag.fixAll', { n: fixable })));
    children.push(...report.findings.map(card));
    slot.replaceChildren(...children);
    if (app.tabs) {
      const urgent = report.counts.error + report.counts.warning;
      app.tabs.badge('diagnostic', urgent, report.counts.error ? 'bad' : 'warn');
    }
  }

  if (app.tabs) app.tabs.add({ id: 'diagnostic', label: 'diag.tab', panels: ['diagnostic'] });

  sim.on(Topics.SCENARIO_LOADED, () => {
    if (!loadingFix) { original = null; applied = 0; } // un autre scénario a été choisi
    paint();
  });
  sim.on(Topics.RESET, paint);
  sim.on(Topics.FINISHED, paint);
  onLangChange(paint);

  // Pendant la lecture, les constats liés au trafic apparaissent et disparaissent.
  setInterval(() => {
    if (sim.state !== 'playing' || !sim.scenario) return;
    const before = signature;
    run();
    if (report.findings.map((item) => item.id).join('|') !== before) paint();
  }, LIVE_REFRESH);

  paint();
  return {
    get report() { return report; },
    fix, fixAll, restore,
  };
}
