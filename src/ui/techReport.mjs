// Panneau « Technologies » : ce que l'appareil fournit, mesuré en direct (techPanel.mjs), et
// la couleur de chaque ligne. Module pur : testé dans tests/techReport.test.mjs.
//
// Niveaux : 'ok' (vert), 'warn' (orange : marche, avec une réserve), 'bad' (rouge : ne marchera
// pas), 'na' (gris : sans objet sur cet appareil, par exemple pas de casque).
//
// Chaque ligne : { id, level, value: { key, params }, tip } ; `key` et `tip` sont des clés de
// texte (i18n, techPanel.mjs). Un paramètre dont la valeur commence par « tech. » est lui-même
// une clé à traduire.

/** Navigateur d'un casque VR autonome (Meta Quest, Pico, Wolvic) d'après son identifiant. */
export function isHeadsetBrowser(userAgent = '') {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(String(userAgent));
}

/** Nom lisible de la carte graphique d'après GPUAdapterInfo ({ vendor, architecture, description }). */
export function gpuName(info) {
  if (!info) return '';
  const parts = [info.vendor, info.architecture].filter((part) => part && String(part).trim());
  return parts.length ? parts.join(' · ') : String(info.description || '').trim();
}

/**
 * @param {Object} f  faits mesurés :
 *   secure, backend ('webgpu' | 'mock'), threeRevision, gpu (nom ou ''), quality ({ setting, level } ou null),
 *   xr (navigator.xr existe), immersiveVR (session immersive-vr possible), xrgpuBinding (XRGPUBinding existe),
 *   headset (navigateur d'un casque), serviceWorker (actif sur la page), cached (fichiers en cache), standalone
 * @returns {{ id: string, level: 'ok'|'warn'|'bad'|'na', value: { key: string, params?: Object }, tip: string|null }[]}
 */
export function techRows(f) {
  const rows = [];
  const row = (id, level, key, params, tip = null) => rows.push({ id, level, value: { key, params }, tip });
  const webgpu = f.backend === 'webgpu';

  row('secure', f.secure ? 'ok' : 'bad', f.secure ? 'tech.v.yes' : 'tech.v.no', undefined, f.secure ? null : 'tech.tip.secure');
  if (webgpu) row('render', 'ok', 'tech.v.webgpu', { revision: f.threeRevision || '?' });
  else row('render', 'bad', 'tech.v.noWebgpu', undefined, 'tech.tip.webgpu');
  if (webgpu) row('gpu', f.gpu ? 'ok' : 'na', f.gpu ? 'tech.v.raw' : 'tech.v.unknown', f.gpu ? { text: f.gpu } : undefined);
  if (webgpu && f.quality) row('quality', 'ok', 'tech.v.quality', { setting: `tech.q.${f.quality.setting}`, level: `tech.q.${f.quality.level}` });

  // WebXR, puis la VR elle-même.
  row('webxr', f.xr ? 'ok' : 'na', f.xr ? 'tech.v.detected' : 'tech.v.absent', undefined, f.xr ? null : 'tech.tip.webxr');
  if (f.xr) row('immersive', f.immersiveVR ? 'ok' : 'na', f.immersiveVR ? 'tech.v.supported' : 'tech.v.noHeadset', undefined, f.immersiveVR ? null : 'tech.tip.headset');
  if (f.xrgpuBinding) row('binding', 'ok', 'tech.v.native');
  else if (f.immersiveVR && f.headset) row('binding', 'bad', 'tech.v.missingBinding', undefined, 'tech.tip.binding');
  else if (f.immersiveVR) row('binding', 'warn', 'tech.v.bridgeOnly', undefined, 'tech.tip.binding');
  else row('binding', 'na', 'tech.v.absent');

  if (!webgpu) row('vr', 'bad', 'tech.v.vrNoWebgpu');
  else if (!f.xr || !f.immersiveVR) row('vr', 'na', 'tech.v.vrNone'); // le conseil est déjà sur la ligne WebXR ou Session VR
  else if (f.xrgpuBinding) row('vr', 'ok', 'tech.v.vrNative');
  else if (f.headset) row('vr', 'bad', 'tech.v.vrImpossible', undefined, 'tech.tip.binding');
  else row('vr', 'ok', 'tech.v.vrBridge');

  // Application installable et hors ligne.
  if (f.serviceWorker && f.cached) row('offline', 'ok', 'tech.v.offlineReady');
  else if (f.serviceWorker) row('offline', 'warn', 'tech.v.offlineSoon', undefined, 'tech.tip.reload');
  else row('offline', 'warn', 'tech.v.noServiceWorker', undefined, f.secure ? 'tech.tip.reload' : 'tech.tip.secure');
  row('installed', f.standalone ? 'ok' : 'na', f.standalone ? 'tech.v.installed' : 'tech.v.notInstalled', undefined, f.standalone ? null : 'tech.tip.install');
  return rows;
}

/**
 * Rapport en texte brut (bouton « Copier le rapport »).
 * @param {ReturnType<typeof techRows>} rows
 * @param {(key: string, params?: Object) => string} translate
 * @param {string} [header]  première ligne (titre, date, navigateur)
 */
export function reportText(rows, translate, header = '') {
  const mark = { ok: '✓', warn: '!', bad: '✗', na: '–' };
  const lines = rows.map((item) => `${mark[item.level]} ${translate(`tech.row.${item.id}`)} : ${valueText(item, translate)}`);
  return (header ? [header, ...lines] : lines).join('\n');
}

/** Texte de la valeur d'une ligne (les paramètres « tech.… » sont traduits). */
export function valueText(item, translate) {
  const params = {};
  for (const [name, value] of Object.entries(item.value.params || {})) {
    params[name] = typeof value === 'string' && value.startsWith('tech.') ? translate(value) : value;
  }
  return translate(item.value.key, params);
}
