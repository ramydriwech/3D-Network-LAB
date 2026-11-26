// Comment installer l'application sur ce navigateur, quand il ne propose pas lui-même de
// fenêtre d'installation (évènement « beforeinstallprompt », Chrome et Edge seulement).
// Module pur : testé dans tests/install.test.mjs.

/**
 * Navigateur, d'après son identifiant (userAgent) : la clé du texte d'aide à afficher.
 * @param {string} userAgent
 * @param {{ touchPoints?: number }} [device]  nombre de points tactiles (un iPad se présente comme un Mac)
 * @returns {'ios'|'android'|'edge'|'firefox'|'safari'|'chrome'}
 */
export function installHelpKey(userAgent = '', { touchPoints = 0 } = {}) {
  const ua = String(userAgent);
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua)) return 'safari';
  return 'chrome';
}
