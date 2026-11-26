// Onglets de la colonne de droite (demande du superviseur : diagnostic, puis éditeur).
//
// La colonne garde ses zones habituelles (explications, équipement, inspecteur, journal) ;
// les onglets ne font que montrer un groupe de zones à la fois. Chaque module ajoute son
// onglet : tabs.add({ id, label, panels: ['diagnostic'] }). Un badge peut s'afficher à côté
// du nom (ex. nombre d'erreurs du diagnostic).

import { el } from './dom.js';
import { onLangChange, registerStrings, t } from './i18n.js';

registerStrings({
  fr: { 'tabs.label': 'Vues du panneau', 'tabs.play': 'Lecture' },
  en: { 'tabs.label': 'Panel views', 'tabs.play': 'Playback' },
});

export function initTabs(app, side = document.querySelector('aside.side')) {
  const bar = el('nav', { class: 'tabs', role: 'tablist', 'aria-label': t('tabs.label') });
  side.prepend(bar);
  const tabs = new Map(); // id -> { label, panels, button, badge }
  const listeners = new Set();
  let current = null;

  function select(id) {
    if (!tabs.has(id)) return;
    current = id;
    for (const [key, tab] of tabs) {
      const active = key === id;
      tab.button.setAttribute('aria-selected', String(active));
      tab.button.classList.toggle('active', active);
      for (const panel of tab.panels) {
        const node = document.getElementById(panel);
        if (node) node.hidden = !active;
      }
    }
    for (const listener of listeners) listener(id);
  }

  function add({ id, label, panels }) {
    const badge = el('span', { class: 'tab-badge', hidden: true });
    const button = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${id}`, onclick: () => select(id) }, el('span', {}, t(label)), badge);
    bar.append(button);
    tabs.set(id, { label, panels, button, badge });
    if (current === null) select(id);
    else for (const panel of panels) { const node = document.getElementById(panel); if (node) node.hidden = true; }
    return button;
  }

  /** Affiche un petit nombre à côté du nom de l'onglet (0 ou null : rien). */
  function badge(id, value, kind = '') {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.badge.hidden = !value;
    tab.badge.textContent = value ? String(value) : '';
    tab.badge.className = `tab-badge ${kind}`;
  }

  onLangChange(() => {
    bar.setAttribute('aria-label', t('tabs.label'));
    for (const tab of tabs.values()) tab.button.firstChild.textContent = t(tab.label);
  });

  add({ id: 'play', label: 'tabs.play', panels: ['explanations', 'info', 'inspector', 'journal'] });

  return {
    add, select, badge,
    get current() { return current; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
