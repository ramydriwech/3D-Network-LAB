// Scène 3D : moteur de rendu, caméra, éclairage et ombres, qualité, sol et navigation.
//
// Éclairage (voir docs/rendu-3d.md) : environnement HDR calculé (environment.mjs) pour la
// lumière indirecte et les reflets, réglage de tonalité « neutre », un « soleil » qui porte
// les ombres. La carte d'ombre est figée et recalculée à la demande (invalidateShadows).
// Qualité Auto / Basse / Haute : quality.mjs.
//
// Moteur (voir docs/choix-moteur-rendu.md) : WebGPURenderer de Three.js, en WebGPU SEULEMENT,
// à l'écran comme en VR (src/xr/gpuBridge.mjs). Sans WebGPU, la scène ne s'affiche pas : un
// message explique quels navigateurs conviennent (src/render/index.mjs). Pas de secours WebGL.
// La navigation (OrbitControls) fonctionne à la souris et au doigt :
//   - glisser : tourner — molette ou pincement : zoomer — clic droit ou deux doigts : déplacer.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.mjs';
import { readQualitySetting, storeQualitySetting, resolveQuality, qualityPreset } from './quality.mjs';
import { environmentPixels, AMBIENCES } from './environment.mjs';
import { requireWebGPU, WebGPUUnavailableError } from './webgpu.mjs';

export { requireWebGPU, WebGPUUnavailableError };

export const BACKGROUND = 0x0b1220;

/** Panorama lumineux (voir environment.mjs) rangé dans une texture HDR en demi-flottants. */
function environmentTexture(kind) {
  const { data, width, height } = environmentPixels(kind);
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const texture = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export async function createScene(container) {
  await requireWebGPU();
  const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.xr.enabled = true; // la session VR est gérée par src/xr/ ; à activer avant init()
  // init() est asynchrone : il ouvre la carte graphique. Si WebGPU échoue malgré tout à ce stade,
  // Three.js passerait de lui-même sur son moteur WebGL : on le refuse (application 100 % WebGPU).
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new WebGPUUnavailableError('init');
  }
  const backend = 'webgpu';
  console.info('[rendu] moteur : WebGPU');
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  // Lumière physique : les valeurs HDR (dalles, reflets) sont ramenées à l'écran par un
  // réglage de tonalité « neutre », qui respecte les teintes (les couleurs des protocoles).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const environments = {};
  const environment = (kind) => (environments[kind] ||= environmentTexture(kind));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
  camera.position.set(0, 12, 16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // ne pas passer sous le sol
  controls.minDistance = 3;
  controls.maxDistance = 80;

  // Éclairage : l'environnement (environment.mjs) donne la lumière indirecte et les reflets ;
  // une lumière douce du ciel et un « soleil » qui porte les ombres complètent.
  const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.35);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(6, 14, 8);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  // La carte d'ombre n'est pas recalculée à chaque image : seulement quand la scène bouge
  // (voir invalidateShadows). Les paquets ne portent pas d'ombre.
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);

  // Tout ce qui appartient à la topologie vit dans `world` : en VR, on réduit et on
  // déplace ce seul groupe pour poser le réseau devant l'utilisateur.
  const world = new THREE.Group();
  scene.add(world);

  // Vue classique : un socle sombre et satiné, plus clair au centre, qui se fond dans le fond
  // (aucun bord visible) ; une grille discrète pour lire les distances ; un léger brouillard
  // de profondeur. Grille, socle et ombres portées se masquent ensemble (laboratoire, VR).
  scene.fog = new THREE.Fog(BACKGROUND, 45, 120);
  const grid = new THREE.GridHelper(60, 60, 0x3b6fd4, 0x22344f);
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  grid.material.toneMapped = false;
  grid.material.depthWrite = false;
  world.add(grid);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = baseCanvas.height = 256;
  const paint = baseCanvas.getContext('2d');
  const glow = paint.createRadialGradient(128, 128, 0, 128, 128, 128);
  glow.addColorStop(0, '#16223a');
  glow.addColorStop(0.55, '#0f182b');
  glow.addColorStop(1, '#0b1220');
  paint.fillStyle = glow;
  paint.fillRect(0, 0, 256, 256);
  const baseMap = new THREE.CanvasTexture(baseCanvas);
  baseMap.colorSpace = THREE.SRGBColorSpace;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({
    map: baseMap, roughness: 0.7, metalness: 0, envMapIntensity: 0.35,
  }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.006;
  base.receiveShadow = true;
  base.raycast = () => {};
  grid.add(base);
  // Sol invisible qui ne montre que les ombres portées, sous la grille (vue classique).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.38 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  ground.raycast = () => {};
  grid.add(ground); // masqué avec la grille (laboratoire, VR)

  // --- Ambiance (vue classique ou laboratoire) et ombres
  let ambience = 'studio';
  function setAmbience(kind) {
    ambience = AMBIENCES[kind] ? kind : 'studio';
    const preset = AMBIENCES[ambience];
    scene.environment = environment(ambience);
    scene.environmentIntensity = preset.environment;
    hemisphere.intensity = preset.hemisphere;
    sun.intensity = preset.sun;
    sun.color.setHex(preset.sunColor);
    invalidateShadows();
  }

  const shadowBox = new THREE.Box3();
  /** Cadre la lumière qui porte les ombres sur une boîte (coordonnées de la scène). */
  function fitShadows(box) {
    if (box.isEmpty()) return;
    shadowBox.copy(box);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const direction = new THREE.Vector3(...AMBIENCES[ambience].sunDirection).normalize();
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(direction, radius * 2 + 5);
    const cam = sun.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 0.1;
    cam.far = radius * 4 + 10;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    invalidateShadows();
  }

  /** Demande de recalculer la carte d'ombre à la prochaine image. */
  function invalidateShadows() { sun.shadow.needsUpdate = true; }

  // --- Qualité (quality.mjs)
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  let quality = { setting: readQualitySetting({ search: window.location.search, storage }), level: 'low' };
  function applyQuality(setting = quality.setting, { remember = false } = {}) {
    const level = resolveQuality(setting, { coarse });
    const preset = qualityPreset(level);
    quality = { setting, level };
    if (remember) storeQualitySetting(setting, storage);
    renderer.shadowMap.enabled = preset.shadows;
    sun.castShadow = preset.shadows;
    ground.visible = preset.shadows;
    if (preset.shadows && sun.shadow.mapSize.x !== preset.shadowMapSize) {
      sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    // Au-delà de 1,5 sur un petit écran, le coût en pixels dépasse le gain visuel.
    if (!renderer.xr.isPresenting) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    invalidateShadows();
    console.info(`[rendu] qualité : ${setting} → ${level}`);
    return { ...quality };
  }
  applyQuality();
  setAmbience('studio');

  function resize() {
    if (renderer.xr.isPresenting) return; // en VR, la taille est imposée par le casque
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  /** Cadre la caméra sur une boîte englobante (la topologie). */
  function frame(box) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z * 1.6, 8);
    // Écran étroit ou en portrait (téléphone tenu droit) : il faut reculer pour garder
    // toute la largeur, équipements et étiquettes des extrémités compris.
    const narrow = camera.aspect < 1.25 ? 1.25 / camera.aspect : 1;
    const distance = (span + 3) * 0.85 * Math.min(narrow, 2.8);
    controls.target.copy(center);
    camera.position.set(center.x, distance * 0.8, center.z + distance);
    controls.update();
  }

  return {
    renderer, backend, scene, camera, controls, world, grid, resize, frame,
    setAmbience, fitShadows, invalidateShadows, applyQuality,
    /** { setting, level, auto } — auto : le niveau que « Auto » choisit sur cet appareil. */
    get quality() { return { ...quality, auto: resolveQuality('auto', { coarse }) }; },
    get ambience() { return ambience; },
  };
}
