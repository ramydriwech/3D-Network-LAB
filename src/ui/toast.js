// Messages brefs affichés en bas de l'écran (installation refusée, VR indisponible…).

let container = null;

/** Affiche `text` quelques secondes. `kind` : 'info' ou 'error'. */
export function toast(text, { kind = 'info', duration = 5000 } = {}) {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = text;
  container.appendChild(item);
  setTimeout(() => item.remove(), duration);
  return item;
}
