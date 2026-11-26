// Niveaux de qualité du rendu : « Auto », « Basse » ou « Haute ».
//
// Ce fichier ne contient que des données et des fonctions pures (pas de Three.js) : il se
// teste sans navigateur. scene.mjs applique le niveau choisi.
//
//   - Basse : environnement lumineux et ombres de contact peintes sous les équipements.
//             Pour les téléphones et les casques autonomes.
//   - Haute : en plus, de vraies ombres portées (une seule lumière, carte d'ombre recalculée
//             seulement quand la scène bouge, pas à chaque image) et une image plus fine.
//   - Auto  : Basse sur un écran tactile (pointeur « grossier »), Haute sinon.
//
// Le choix est mémorisé dans le navigateur ; ?quality=low ou ?quality=high dans l'adresse
// l'impose pour une démonstration ou une capture.

export const QUALITY_SETTINGS = Object.freeze(['auto', 'low', 'high']);
export const QUALITY_STORAGE_KEY = '3dnt.quality';

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ shadows: false, shadowMapSize: 0, pixelRatioCap: 1.5 }),
  high: Object.freeze({ shadows: true, shadowMapSize: 2048, pixelRatioCap: 2 }),
});

/** Réglage valide ('auto' | 'low' | 'high') ou null. */
export function parseQuality(value) {
  return QUALITY_SETTINGS.includes(value) ? value : null;
}

/**
 * Réglage demandé : l'adresse (?quality=…) l'emporte, puis le choix mémorisé, sinon 'auto'.
 * @param {{ search?: string, storage?: Storage|null }} [where]
 */
export function readQualitySetting({ search = '', storage = null } = {}) {
  const asked = parseQuality(new URLSearchParams(search).get('quality'));
  if (asked) return asked;
  try {
    return parseQuality(storage && storage.getItem(QUALITY_STORAGE_KEY)) || 'auto';
  } catch {
    return 'auto'; // stockage indisponible (navigation privée)
  }
}

/** Mémorise le réglage ; sans effet si le stockage est indisponible. */
export function storeQualitySetting(setting, storage) {
  try {
    if (storage && parseQuality(setting)) storage.setItem(QUALITY_STORAGE_KEY, setting);
  } catch { /* navigation privée */ }
}

/** Niveau réellement appliqué ('low' | 'high') pour un réglage et un appareil. */
export function resolveQuality(setting, { coarse = false } = {}) {
  if (setting === 'low' || setting === 'high') return setting;
  return coarse ? 'low' : 'high';
}

/** Paramètres d'un niveau : { shadows, shadowMapSize, pixelRatioCap }. */
export function qualityPreset(level) {
  return QUALITY_PRESETS[level] || QUALITY_PRESETS.low;
}
