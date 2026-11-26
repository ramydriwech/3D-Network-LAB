// Petit outil pour construire le DOM sans innerHTML (donc sans risque d'injection).

/**
 * el('button', { class: 'btn', onclick: fn, 'data-i18n': 'cle' }, 'texte', autreElement…)
 * Un attribut dont la valeur est null, undefined ou false est ignoré.
 */
export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
    else if (name === 'class') element.className = value;
    else if (name === 'text') element.textContent = value;
    else element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Titre de panneau standard. */
export function panelTitle(key) {
  return el('h2', { class: 'panel-title', 'data-i18n': key });
}
