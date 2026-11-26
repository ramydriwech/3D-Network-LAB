// API de rendu : la liste des fonctions et propriétés que les autres modules ont le droit
// d'utiliser. Le vrai rendu (index.mjs) et le faux (mockRender.mjs) fournissent exactement
// cette liste ; un test le vérifie. Description détaillée : docs/api-rendu.md.

export const RENDER_API = Object.freeze([
  'scene',        // THREE.Scene
  'camera',       // THREE.PerspectiveCamera
  'renderer',     // THREE.WebGPURenderer (renderer.xr pour la VR)
  'backend',      // toujours 'webgpu' (application 100 % WebGPU) ; 'mock' pour le faux rendu
  'domElement',   // le canevas, pour écouter clics et touchers
  'controls',     // OrbitControls (désactivés pendant une session VR)
  'world',        // groupe qui contient toute la topologie (réduit et déplacé en VR)
  'packetLayer',  // groupe où l'animateur ajoute les paquets
  'maxPackets',   // nombre maximal de paquets affichés en même temps
  'showTopology', // (scenario) affiche les équipements et les câbles
  'anchor',       // (deviceId) -> Vector3 : point de départ/arrivée des paquets
  'linkPath',     // (linkId) -> { curve, start, length } ou null : trajet d'un câble, suivi par les paquets
  'deviceObject', // (deviceId) -> Object3D ou null
  'pickables',    // () -> Object3D[] : objets sélectionnables (userData.kind)
  'highlight',    // (ids[]) met en évidence les équipements sélectionnés
  'makeLabel',    // (lignes[], options) -> étiquette (Sprite)
  'packetStyle',  // (packet) -> { color, cast } : couleur du protocole, type de diffusion
  'packetColor',  // (packet) -> '#rrggbb'
  'legend',       // () -> [{ id, name, color }]
  'setVRMode',    // (bool) adapte la scène à la VR
  'resize',       // () recalcule la taille du canevas
  'onFrame',      // (callback(dtMs)) -> fonction de désabonnement
  'start',        // (tick(dtMs)) lance la boucle d'affichage
  'quality',      // { setting: 'auto'|'low'|'high', level, auto: 'low'|'high' } qualité de l'image
  'setQuality',   // (setting) change la qualité et la mémorise ; retourne { setting, level }
  'viewScale',    // échelle d'affichage des objets : 1,5 en mode classique, 1 dans le laboratoire
  'setViewScale', // (scale) grossit équipements, câbles, paquets et étiquettes (les distances ne changent pas)
]);
