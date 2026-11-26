# Choix du moteur de rendu : 100 % WebGPU, VR comprise

Tâche n° 16 (S1) : tester WebXR dans l'émulateur pour fixer le moteur de rendu **avant** d'écrire le reste de la scène.
C'était le premier risque du cahier des charges (« WebXR/WebGPU incompatibles »).

## Décision

**`WebGPURenderer` de Three.js, en WebGPU seulement**, version figée **r187** (`vendor/three/`, voir
`vendor/three/VERSION`) : à l'écran comme en VR, l'application ne dessine qu'en WebGPU. Il n'y a **aucun secours
WebGL**.

| Situation au démarrage | Résultat |
| --- | --- |
| navigateur avec WebGPU et une carte graphique acceptée | **WebGPU** : la scène s'affiche, pastille « WebGPU » (un clic ouvre le panneau « Technologies », `src/ui/techPanel.mjs`) |
| navigateur sans WebGPU | pas de scène 3D : message « Ce navigateur ne connaît pas WebGPU… » et liste des navigateurs qui conviennent |
| WebGPU désactivé, carte ou pilote refusés | pas de scène 3D : message « WebGPU est désactivé ou cette carte graphique n'est pas prise en charge… » |
| WebGPU qui échoue au démarrage du moteur | pas de scène 3D : message « WebGPU n'a pas pu démarrer… » (le passage automatique de Three.js sur son moteur WebGL est refusé) |

Dans les trois derniers cas, le reste de l'application fonctionne (scénarios, explications, journal, inspecteur,
consoles) : seule la scène 3D manque.

Historique : jusqu'en S6, la VR passait par le moteur WebGL 2 du même `WebGPURenderer` (la liaison WebGPU–WebXR était
trop récente) ; en S7, un pont maison a fait passer la VR en WebGPU ([vr-webgpu.md](vr-webgpu.md)) ; WebGL 2 n'était
plus qu'un secours. Il a été retiré : l'application est désormais **100 % WebGPU**.

## Comment c'est fait

| Étape | Où | Ce qui se passe |
| --- | --- | --- |
| 1. vérifier WebGPU | `requireWebGPU()` (`src/render/webgpu.mjs`, testé) | `navigator.gpu` existe et `requestAdapter()` fournit une carte ; sinon `WebGPUUnavailableError` (`'absent'` ou `'adapter'`) |
| 2. créer le moteur | `createScene()` (`src/render/scene.mjs`) | `new WebGPURenderer(…)` sans `forceWebGL`, puis `await renderer.init()` (l'accès à la carte est asynchrone) |
| 3. refuser le repli | `createScene()` | si Three.js est passé malgré tout sur WebGL (`renderer.backend.isWebGPUBackend` faux), le moteur est libéré et `WebGPUUnavailableError('init')` est levée |
| 4. prévenir l'utilisateur | `showFailure()` (`src/render/index.mjs`) | message en français et en anglais dans la scène ; le faux rendu (`mockRender.mjs`) prend le relais pour que le reste de l'application marche |
| VR | `src/xr/gpuBridge.mjs` | deux voies, toutes deux en WebGPU : directe (`XRGPUBinding`) ou pont pour émulateur ; voir [vr-webgpu.md](vr-webgpu.md) |

Un test (`tests/webgpu.test.mjs`) vérifie aussi qu'aucun fichier de `src/` ne réintroduit `forceWebGL`,
`?backend=webgl` ou un contexte WebGL.

## Navigateurs qui conviennent

Chrome et Edge récents (PC, Mac, Android 12 ou plus avec une carte graphique prise en charge), Safari 26 ou plus
récent (macOS, iOS, iPadOS), Firefox 141 ou plus récent (Windows). L'accélération matérielle doit être activée, et le
pilote graphique à jour. En VR sur un vrai casque, le navigateur du casque doit en plus relier WebXR et WebGPU
(`XRGPUBinding`, voir [vr-webgpu.md](vr-webgpu.md)).

## Protocole de test (à refaire à chaque changement de version de Three.js)

Poste : Chrome récent sur PC, site servi sur `http://localhost:8080` ou sur GitHub Pages (WebGPU et WebXR exigent un contexte sécurisé).

**A. WebGPU à l'écran**

1. Ouvrir l'application : la pastille en bas à droite de la scène indique « WebGPU ». La console affiche `[rendu] moteur : WebGPU`.
2. Le laboratoire, puis le mode classique, s'affichent ; lecture, pause, sélection à la souris fonctionnent.
3. Dans `chrome://flags`, désactiver WebGPU (« Unsafe WebGPU Support » / accélération matérielle) puis recharger : le
   message « WebGPU … La scène 3D a besoin de WebGPU » s'affiche, et Lecture fait toujours avancer le journal.

**B. VR, avec l'émulateur** (extension Immersive Web Emulator activée, page rechargée)

4. La pastille indique « WebGPU » et le bouton « Entrer en VR » est actif.
5. Entrer en VR : message « VR WebGPU (pont pour émulateur) » ; la salle et le panneau s'affichent ; dans l'onglet
   WebXR des outils de développement, la tête et les manettes bougent.
6. Gâchette sur un bouton du panneau, puis sur un équipement.
7. Quitter la session : retour à l'écran, la souris fonctionne à nouveau.

## Résultats relevés

| Date | Navigateur | Carte graphique | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Testeur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| *à remplir* | Chrome … | | | | | | | | | Ayoub |

> Ce tableau se remplit sur le poste de test : noter « OK » ou le message d'erreur exact.
>
> Vérifications automatiques déjà faites (Chrome sans écran) : avec WebGPU, l'application s'ouvre dans le laboratoire,
> pastille « WebGPU », sans erreur ; navigateur sans WebGPU, et carte graphique refusée : le bon message s'affiche et
> la simulation continue de fonctionner.
