// Fenêtre de console des équipements (laboratoire de Steve, S7).
//
// Deux parties :
//   1. les SESSIONS (sans affichage) : une par équipement, avec son interpréteur
//      (src/sim/cli.js), son texte affiché, sa ligne en cours et son historique. Elles
//      appliquent les changements de configuration et jouent ping / traceroute. Le panneau
//      de console en VR (src/xr/vrConsole.js) utilise exactement les mêmes sessions ;
//   2. la FENÊTRE pour l'écran classique : un terminal (texte vert sur fond noir) avec un
//      onglet par équipement ouvert. Entrée exécute, Tab complète, « ? » donne l'aide,
//      ↑ / ↓ parcourent l'historique, Échap réduit la fenêtre.

import { Topics } from '../sim/events.js';
import { createConsole, formatRun } from '../sim/cli.js';
import { modelOf } from '../sim/catalog.js';
import { el } from './dom.js';
import { toast } from './toast.js';
import { onLangChange, registerStrings, t, getLang } from './i18n.js';

registerStrings({
  fr: {
    'term.title': 'Consoles',
    'term.open': 'Ouvrir la console',
    'term.close': 'Fermer',
    'term.min': 'Réduire',
    'term.hint': 'Entrée : exécuter · Tab : compléter · ? : aide · ↑↓ : historique',
    'term.applied': '[configuration appliquée : le réseau est relancé]',
    'term.running': '[échange en cours dans la scène…]',
    'term.unmanaged': '{name} est un {model} non administrable : il n\'a pas de console. Choisissez un modèle administrable (CX-24M, VS-24) dans l\'onglet Construire.',
  },
  en: {
    'term.title': 'Consoles',
    'term.open': 'Open the console',
    'term.close': 'Close',
    'term.min': 'Minimise',
    'term.hint': 'Enter: run · Tab: complete · ?: help · ↑↓: history',
    'term.applied': '[configuration applied: the network restarts]',
    'term.running': '[exchange running in the scene…]',
    'term.unmanaged': '{name} is an unmanaged {model}: it has no console. Pick a managed model (CX-24M, VS-24) in the Build tab.',
  },
});

/** Nombre de lignes gardées par session. */
const MAX_LINES = 400;

/** Peut-on ouvrir une console sur cet équipement ? (un switch non administrable n'en a pas) */
export function hasConsole(def) {
  if (!def) return false;
  if (def.type !== 'switch') return true;
  const model = modelOf(def);
  return !!(model && model.os);
}

/**
 * Gestionnaire des sessions et de la fenêtre.
 * @returns {{ open(id), session(id), sessions, onChange(fn), close(id) }}
 */
export function createTerminals(app) {
  const { sim } = app;
  const sessions = new Map(); // id -> session
  const listeners = new Set();
  const notify = (id) => { for (const fn of listeners) fn(id); };
  let busy = null; // échange en cours lancé par une console

  const api = {
    scenario: () => sim.scenario,
    device: (id) => sim.device(id),
    lang: () => (getLang ? getLang() : 'fr'),
    now: () => sim.now,
  };

  /** Recharge le réseau modifié sans faire bouger la caméra. */
  async function applyScenario(scenario) {
    const render = app.render;
    const previous = render ? render.keepCamera : false;
    if (render) render.keepCamera = true;
    try {
      if (app.editor && app.editor.active) app.editor.change(() => scenario);
      else await sim.loadScenario(scenario);
    } finally {
      if (render) setTimeout(() => { render.keepCamera = previous; }, 0);
    }
  }

  /** Joue un ping, un traceroute… puis écrit le résultat dans la session. */
  function play(session, run) {
    const replies = [];
    let stepIndex = -1;
    const perStep = new Map();
    const source = session.id;
    const offs = [];
    offs.push(sim.on(Topics.STEP, ({ index }) => { stepIndex = index; }));
    offs.push(sim.on(Topics.PACKET_RECEIVE, (event) => {
      if (event.device !== source || !event.accepted) return;
      const packet = event.packet;
      if (packet.icmp) {
        const type = packet.icmp.type === 0 ? 'reply' : packet.icmp.type === 11 ? 'ttl' : packet.icmp.type === 3 ? 'unreachable' : null;
        if (!type) return;
        const entry = { type, from: packet.ip.src, ttl: packet.ip.ttl };
        if (run.kind === 'trace') {
          if (!perStep.has(stepIndex)) perStep.set(stepIndex, entry);
          if (type === 'reply' || type === 'unreachable') setTimeout(() => finish(true), 0);
        } else replies.push(entry);
      }
    }));
    let done = false;
    const finish = (early = false) => {
      if (done) return;
      done = true;
      for (const off of offs) off();
      busy = null;
      if (early && sim.state === 'playing') sim.execute('pause');
      let lines = [];
      if (run.kind === 'ping' || run.kind === 'trace') {
        const list = run.kind === 'trace'
          ? Array.from({ length: Math.max(...perStep.keys(), -1) + 1 }, (_, i) => perStep.get(i) || { type: 'timeout' })
          : replies;
        lines = formatRun(session.con.dialect, run, list);
      } else if (run.kind === 'dns') {
        const device = sim.device(source);
        const answer = device && device.dnsCache ? device.dnsCache.get(run.name) : null;
        lines = answer ? ['Non-authoritative answer:', `Name:    ${run.name}`, `Address:  ${answer}`] : [`*** ${run.name} can't be found: Non-existent domain`];
      } else if (run.kind === 'http') {
        const page = sim.device(source) && sim.device(source).httpLast;
        lines = page ? [`HTTP/1.1 ${page.status} ${page.reason || ''}`, page.title ? `<title>${page.title}</title>` : '', page.body || ''].filter(Boolean) : ['curl: (7) Failed to connect'];
      } else if (run.kind === 'dhcp') {
        const iface = sim.device(source) && sim.device(source).primary();
        lines = iface && iface.ip ? ['', `   IPv4 Address. . . . . . . . . . . : ${iface.ip}`] : ['An error occurred while renewing interface eth0: unable to contact your DHCP server.'];
      }
      session.write(lines);
    };
    offs.push(sim.on(Topics.FINISHED, () => finish(false)));
    busy = session.id;
    session.write([t('term.running')], 'muted');
    sim.runActions ? sim.runActions(run.steps) : sim.runAction(run.steps[0]);
  }

  function makeSession(id) {
    const con = createConsole(api, id);
    const session = {
      id,
      con,
      lines: [],      // { text, kind }
      input: '',
      historyIndex: null,
      get name() { const d = sim.scenario && sim.scenario.devices.find((x) => x.id === id); return d ? d.name : id; },
      get prompt() { return con.prompt(); },
      write(lines, kind = 'out') {
        for (const text of [].concat(lines)) for (const part of String(text).split('\n')) session.lines.push({ text: part, kind });
        if (session.lines.length > MAX_LINES) session.lines.splice(0, session.lines.length - MAX_LINES);
        notify(id);
      },
      /** Exécute la ligne `text` (ou la ligne en cours). */
      async submit(text = session.input) {
        const line = text;
        session.write(`${con.prompt()}${line}`, 'cmd');
        session.input = '';
        session.historyIndex = null;
        const result = con.execute(line);
        if (result.clear) { session.lines.length = 0; notify(id); return result; }
        if (result.lines.length) session.write(result.lines, result.error ? 'error' : 'out');
        if (result.scenario) {
          await applyScenario(result.scenario);
          session.write(t('term.applied'), 'muted');
        }
        if (result.run) {
          if (busy) session.write('% Busy: another exchange is running.', 'error');
          else play(session, result.run);
        }
        notify(id);
        return result;
      },
      complete() { session.input = con.complete(session.input); notify(id); },
      help() { session.write(`${con.prompt()}${session.input}?`, 'cmd'); session.write(con.help(session.input), 'out'); },
      historyStep(delta) {
        const history = con.history();
        if (!history.length) return;
        let index = session.historyIndex == null ? history.length : session.historyIndex;
        index = Math.max(0, Math.min(history.length, index + delta));
        session.historyIndex = index;
        session.input = history[index] || '';
        notify(id);
      },
    };
    session.write(con.banner(), 'muted');
    return session;
  }

  // ---------------------------------------------------------------- la fenêtre
  const windowEl = el('section', { id: 'terminal', class: 'terminal', hidden: true, role: 'dialog', 'aria-label': t('term.title') });
  const tabsEl = el('div', { class: 'term-tabs', role: 'tablist' });
  const outputEl = el('pre', { class: 'term-output', 'aria-live': 'polite' });
  const promptEl = el('span', { class: 'term-prompt' });
  const inputEl = el('input', { class: 'term-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'console' });
  const hintEl = el('div', { class: 'term-hint' }, t('term.hint'));
  const minButton = el('button', { type: 'button', class: 'term-btn', title: t('term.min'), onclick: () => { windowEl.hidden = true; } }, '—');
  windowEl.append(
    el('header', { class: 'term-head' }, tabsEl, minButton),
    outputEl,
    el('div', { class: 'term-line' }, promptEl, inputEl),
    hintEl,
  );
  document.body.append(windowEl);
  let current = null;

  // Déplacer la fenêtre en la tenant par son en-tête.
  windowEl.querySelector('.term-head').addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const start = { x: event.clientX, y: event.clientY, left: windowEl.offsetLeft, top: windowEl.offsetTop };
    const move = (e) => {
      windowEl.style.left = `${Math.max(0, start.left + e.clientX - start.x)}px`;
      windowEl.style.top = `${Math.max(0, start.top + e.clientY - start.y)}px`;
      windowEl.style.bottom = 'auto';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function paintTabs() {
    tabsEl.replaceChildren(...[...sessions.values()].map((session) => el('span', { class: `term-tab ${session.id === current ? 'active' : ''}` },
      el('button', { type: 'button', class: 'term-tab-name', onclick: () => select(session.id) }, session.name),
      el('button', { type: 'button', class: 'term-tab-close', title: t('term.close'), onclick: () => close(session.id) }, '×'))));
  }

  function paintOutput() {
    const session = sessions.get(current);
    if (!session) return;
    outputEl.replaceChildren(...session.lines.map((line) => el('span', { class: `term-${line.kind}` }, line.text + '\n')));
    promptEl.textContent = session.prompt;
    if (inputEl.value !== session.input) inputEl.value = session.input;
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function select(id) {
    current = id;
    paintTabs();
    paintOutput();
    inputEl.focus();
  }

  function close(id) {
    sessions.delete(id);
    if (current === id) current = sessions.keys().next().value || null;
    if (!current) windowEl.hidden = true;
    paintTabs();
    paintOutput();
    notify(id);
  }

  /** Ouvre (ou retrouve) la console d'un équipement. `show` : afficher la fenêtre. */
  function open(id, { show = true } = {}) {
    const def = sim.scenario && sim.scenario.devices.find((d) => d.id === id);
    if (!def) return null;
    if (!hasConsole(def)) {
      const model = modelOf(def);
      toast(t('term.unmanaged', { name: def.name, model: model ? model.name : def.type }), { kind: 'error' });
      return null;
    }
    if (!sessions.has(id)) sessions.set(id, makeSession(id));
    if (show) {
      windowEl.hidden = false;
      select(id);
    }
    return sessions.get(id);
  }

  inputEl.addEventListener('input', () => {
    const session = sessions.get(current);
    if (!session) return;
    // « ? » au bout de la ligne : l'aide s'affiche aussitôt, comme sur le vrai matériel.
    if (inputEl.value.endsWith('?') && session.con.dialect !== 'pc') {
      session.input = inputEl.value.slice(0, -1);
      session.help();
      inputEl.value = session.input;
      return;
    }
    session.input = inputEl.value;
  });
  inputEl.addEventListener('keydown', (event) => {
    const session = sessions.get(current);
    if (!session) return;
    event.stopPropagation(); // les raccourcis de l'application (Espace, R…) ne s'appliquent pas ici
    if (event.key === 'Enter') { event.preventDefault(); session.submit(inputEl.value); }
    else if (event.key === 'Tab') { event.preventDefault(); session.input = inputEl.value; session.complete(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); session.historyStep(-1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); session.historyStep(1); }
    else if (event.key === 'Escape') windowEl.hidden = true;
    else if ((event.key === 'z' || event.key === 'c') && event.ctrlKey) { event.preventDefault(); session.submit(session.con.dialect === 'vrp' ? 'return' : 'end'); }
  });
  inputEl.addEventListener('keyup', (event) => event.stopPropagation());
  outputEl.addEventListener('click', () => inputEl.focus());

  listeners.add((id) => {
    if (id === current) paintOutput();
    paintTabs();
  });

  // Un autre scénario : les consoles des équipements qui n'existent plus se ferment.
  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => {
    for (const id of [...sessions.keys()]) if (!scenario.devices.some((d) => d.id === id)) close(id);
    paintTabs();
    if (current) paintOutput();
  });
  onLangChange(() => { hintEl.textContent = t('term.hint'); minButton.title = t('term.min'); paintTabs(); });

  return {
    open,
    close,
    session: (id) => sessions.get(id) || null,
    sessions,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get busy() { return busy; },
    hide() { windowEl.hidden = true; },
  };
}
