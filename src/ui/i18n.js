// Langue de l'interface : français par défaut, anglais par le bouton FR/EN.
//
// Chaque module déclare ses propres textes avec registerStrings() puis les lit avec t().
// Les textes des scénarios et des protocoles sont des objets { fr, en } : localize()
// choisit la bonne version. Le choix de l'utilisateur est mémorisé dans le navigateur.

import { formatText } from '../sim/events.js';

export const LANGS = Object.freeze(['fr', 'en']);
const STORAGE_KEY = '3dnt.lang';

const dictionary = { fr: {}, en: {} };
const listeners = new Set();
let current = 'fr';

function readStored() {
  try {
    const stored = globalThis.localStorage && globalThis.localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(stored) ? stored : null;
  } catch {
    return null; // stockage indisponible (navigation privée) : on reste en français
  }
}
current = readStored() || 'fr';

/** Ajoute des textes : registerStrings({ fr: { 'cle': '…' }, en: { 'cle': '…' } }). */
export function registerStrings(strings) {
  for (const lang of LANGS) Object.assign(dictionary[lang], strings[lang] || {});
}

export function getLang() {
  return current;
}

/** Texte d'interface dans la langue courante ; {nom} est remplacé par params.nom. */
export function t(key, params) {
  const template = dictionary[current][key] ?? dictionary.fr[key] ?? key;
  return formatText(template, params);
}

/** Choisit la version d'un texte { fr, en } ; toute autre valeur est convertie en texte. */
export function localize(value) {
  if (value && typeof value === 'object' && ('fr' in value || 'en' in value)) {
    return value[current] ?? value.fr ?? value.en ?? '';
  }
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Texte d'une note d'explication ({ key, params }) dans la langue courante.
 * `sim.text(key)` fournit le modèle { fr, en } (scénario d'abord, protocole ensuite).
 */
export function formatNote(sim, note) {
  const template = sim.text(note.key);
  if (!template) return note.key;
  const params = {};
  for (const [name, value] of Object.entries(note.params || {})) params[name] = localize(value);
  return formatText(localize(template), params);
}

/** Traduit les éléments marqués data-i18n (texte) et data-i18n-title (infobulle). */
export function applyI18n(root = globalThis.document) {
  if (!root) return;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    const text = t(element.dataset.i18nTitle);
    element.title = text;
    element.setAttribute('aria-label', text);
  }
}

export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* stockage indisponible : le choix vaudra pour cette visite */ }
  if (globalThis.document) {
    globalThis.document.documentElement.lang = lang;
    applyI18n(globalThis.document);
  }
  for (const listener of [...listeners]) listener(lang);
}

/** Prévient `listener(lang)` à chaque changement de langue ; retourne le désabonnement. */
export function onLangChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

registerStrings({
  fr: { 'lang.switch': 'English', 'lang.title': 'Switch to English' },
  en: { 'lang.switch': 'Français', 'lang.title': 'Passer en français' },
});

/** Bouton de changement de langue : il affiche la langue vers laquelle on bascule. */
export function createLangToggle(slot) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'lang-toggle';
  button.className = 'btn btn-ghost';
  const refresh = () => {
    button.textContent = t('lang.switch');
    button.title = t('lang.title');
    button.setAttribute('aria-label', t('lang.title'));
    button.lang = current === 'fr' ? 'en' : 'fr';
  };
  button.addEventListener('click', () => setLang(current === 'fr' ? 'en' : 'fr'));
  onLangChange(refresh);
  refresh();
  slot.replaceChildren(button);
  document.documentElement.lang = current;
  return button;
}
