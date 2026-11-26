# API de rendu

`initRender({ container, sim })` (dans `src/render/index.mjs`) crée la scène et retourne **l'API de
rendu** : la seule chose que l'interface, la VR et l'animation des paquets ont le droit d'utiliser.
La liste officielle est `RENDER_API` dans `src/render/api.mjs` ; `tests/render-api.test.mjs` vérifie
que le vrai rendu et le mock la fournissent en entier.

| Membre | Type | Rôle |
| --- | --- | --- |
| `scene` | `THREE.Scene` | la scène |
| `camera` | `THREE.PerspectiveCamera` | la caméra |
| `renderer` | `THREE.WebGPURenderer` | le moteur ; `renderer.xr` sert à la VR |
| `backend` | `'webgpu'` | toujours WebGPU : l'application n'a pas de secours WebGL (`'mock'` pour le faux rendu, utilisé aussi quand WebGPU manque) ; voir [choix-moteur-rendu.md](choix-moteur-rendu.md) |
| `domElement` | `HTMLCanvasElement` | le canevas, pour écouter clics et touchers |
| `controls` | `OrbitControls` | navigation ; désactivée pendant une session VR |
| `world` | `THREE.Group` | groupe qui contient toute la topologie |
| `packetLayer` | `THREE.Group` | groupe où l'animateur ajoute les paquets |
| `maxPackets` | nombre | paquets affichés en même temps au maximum |
| `showTopology(scenario)` | fonction | affiche équipements et câbles d'un scénario |
| `anchor(deviceId)` | → `Vector3` | point de départ ou d'arrivée des paquets (trajet de secours, onde d'un broadcast) |
| `linkPath(linkId)` | → `{ curve, start, length }` ou `null` | trajet d'un câble : courbe Three.js qui va de l'équipement `start` (côté « a » du lien) à l'autre, branchée dans les prises ; les paquets la suivent |
| `deviceObject(deviceId)` | → `Object3D` ou `null` | objet 3D d'un équipement |
| `pickables()` | → `Object3D[]` | objets sélectionnables |
| `highlight(ids)` | fonction | entoure les équipements sélectionnés (1er bleu, 2e vert) |
| `makeLabel(lignes, options)` | → `Sprite` | crée une étiquette |
| `packetStyle(packet)` | → `{ color, cast }` | couleur du protocole et type de diffusion (`unicast`, `broadcast`, `multicast`) |
| `packetColor(packet)` | → `'#rrggbb'` | couleur du protocole |
| `legend()` | → `[{ id, name, color }]` | légende des couleurs |
| `setVRMode(bool)` | fonction | adapte la scène à la VR |
| `resize()` | fonction | recalcule la taille du canevas |
| `onFrame(callback)` | → désabonnement | `callback(dtMs)` à chaque image |
| `start(tick)` | fonction | lance la boucle d'affichage ; `tick(dtMs)` fait avancer la simulation |
| `quality` | `{ setting, level, auto }` | qualité de l'image : réglage (`'auto'`, `'low'`, `'high'`), niveau appliqué (`'low'` ou `'high'`) et niveau que « Auto » choisit sur cet appareil ; voir [rendu-3d.md](rendu-3d.md#éclairage-ombres-et-qualité) |
| `setQuality(setting)` | → `{ setting, level }` | change la qualité et la mémorise dans le navigateur (liste « Qualité » de la barre de commandes) |
| `viewScale` | nombre | échelle d'affichage des objets : 1,5 en mode classique (`CLASSIC_SCALE`), 1 dans le laboratoire ; l'animateur de paquets s'en sert pour la taille des paquets |
| `setViewScale(scale)` | — | grossit équipements, câbles (épaisseur, connecteurs), paquets et étiquettes par rapport aux distances de la topologie, qui ne changent pas ; appelé par le laboratoire en entrant (1) et en sortant (1,5) ; voir [rendu-3d.md](rendu-3d.md#mode-classique-et-laboratoire) |

## Convention de sélection

Un objet sélectionnable porte `userData.kind` :

- `{ kind: 'device', id }` sur le groupe d'un équipement ;
- `{ kind: 'packet', packet, tx }` sur le maillage d'un paquet.

`pick()` (`src/ui/selection.mjs`) remonte la hiérarchie depuis l'objet touché jusqu'au premier parent
qui porte `userData.kind`. Les étiquettes et les anneaux de sélection ont un `raycast` vide : le clic les traverse.

## Mock

```js
import { createMockRender } from './src/render/mockRender.mjs';
const render = createMockRender();
render.showTopology(scenario);
render.calls;      // [{ name: 'showTopology', args: [scenario] }]
render.step(16);   // simule une image
```
