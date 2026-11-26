// Étiquettes : du texte dessiné dans un canevas 2D puis affiché sur un « sprite », un
// rectangle qui fait toujours face à la caméra (donc lisible sous tous les angles, VR comprise).

import * as THREE from 'three';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_PX = 46;
const LINE_PX = 34;
const PADDING = 18;

function draw(canvas, lines, { color, background, accent }) {
  const context = canvas.getContext('2d');
  const fonts = lines.map((line, i) => `${i === 0 ? '600 ' + TITLE_PX : LINE_PX}px ${FONT}`);
  let width = 0;
  lines.forEach((line, i) => {
    context.font = fonts[i];
    width = Math.max(width, context.measureText(line).width);
  });
  const height = lines.reduce((sum, line, i) => sum + (i === 0 ? TITLE_PX : LINE_PX) * 1.25, 0);
  canvas.width = Math.ceil(width + PADDING * 2);
  canvas.height = Math.ceil(height + PADDING * 1.4);

  context.fillStyle = background;
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, 16);
  context.fill();
  if (accent) {
    context.fillStyle = accent;
    context.fillRect(0, 0, 10, canvas.height);
  }
  context.textAlign = 'center';
  context.textBaseline = 'top';
  let y = PADDING * 0.7;
  lines.forEach((line, i) => {
    context.font = fonts[i];
    context.fillStyle = i === 0 ? color : '#a5b4cb';
    context.fillText(line, canvas.width / 2, y);
    y += (i === 0 ? TITLE_PX : LINE_PX) * 1.25;
  });
}

function fit(sprite) {
  const { canvas, size } = sprite.userData;
  const height = (canvas.height / 100) * 0.56 * size;
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
}

/**
 * Crée une étiquette. `lines` : première ligne en gras (le nom), les suivantes en plus petit.
 * @param {Object} [options] size (facteur de taille), color, background, accent (couleur du liseré)
 */
export function createLabel(lines, options = {}) {
  const style = { size: 1, color: '#f1f5f9', background: 'rgba(15, 23, 42, 0.86)', accent: null, ...options };
  const canvas = document.createElement('canvas');
  draw(canvas, lines, style);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // toneMapped: false — une étiquette est un élément d'interface : ses couleurs restent exactes.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }));
  sprite.renderOrder = 10;
  sprite.raycast = () => {}; // une étiquette ne se sélectionne pas : le clic la traverse
  sprite.userData = { canvas, style, size: style.size, lines: lines.join('\n') };
  fit(sprite);
  return sprite;
}

/** Change le texte d'une étiquette existante (ex. adresse IP reçue par DHCP). */
export function updateLabel(sprite, lines) {
  if (sprite.userData.lines === lines.join('\n')) return;
  draw(sprite.userData.canvas, lines, sprite.userData.style);
  sprite.userData.lines = lines.join('\n');
  sprite.material.map.dispose();
  sprite.material.map = new THREE.CanvasTexture(sprite.userData.canvas);
  sprite.material.map.colorSpace = THREE.SRGBColorSpace;
  fit(sprite);
}

/** Change la taille d'une étiquette (les étiquettes sont agrandies en VR). */
export function resizeLabel(sprite, size) {
  sprite.userData.size = size;
  fit(sprite);
}
