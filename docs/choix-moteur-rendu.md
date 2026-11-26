# Choix du moteur de rendu : WebGPU et WebXR

Tâche n° 16 (S1) : tester WebXR dans l'émulateur pour fixer le moteur de rendu **avant** d'écrire le reste de la scène.
C'est le premier risque du cahier des charges (« WebXR/WebGPU incompatibles »).

## Décision

**`WebGPURenderer` de Three.js partout**, version figée **r187** (`vendor/three/`, voir `vendor/three/VERSION`) :

| Situation au démarrage | Moteur de `WebGPURenderer` |
| --- | --- |
| mode classique, navigateur avec WebGPU | **WebGPU** |
| navigateur sans WebGPU, ou carte graphique refusée | WebGL 2 (secours intégré à `WebGPURenderer`) |
| une session VR est possible (casque ou Immersive Web Emulator) | WebGL 2 : la voie compatible WebXR |

C'est exactement ce que demande le cahier des charges : « Three.js avec WebGPURenderer pour le rendu classique lorsque pris
en charge ; une voie WebGL 2 compatible XR est prévue si nécessaire ».

> **Mise à jour S7** : la VR passe désormais aussi par WebGPU (voir `docs/vr-webgpu.md`). La
> section ci-dessous décrit le choix fait jusqu'en S6, gardé pour la voie de secours
> `?backend=webgl`.

## Pourquoi la VR passe par WebGL 2

- Avec le moteur WebGPU, Three.js r187 n'ouvre une session XR que si le navigateur fournit `XRGPUBinding` et la fonction de
  session `webgpu`. Cette liaison WebGPU–WebXR est encore expérimentale et l'émulateur exigé pour la démonstration ne la propose pas.
- Avec le moteur WebGL 2 du même `WebGPURenderer`, la session `immersive-vr` s'ouvre normalement.
- Le moteur ne peut pas être remplacé une fois créé. `chooseBackend()` (`src/render/scene.js`) décide donc au démarrage :
  si `navigator.xr.isSessionSupported('immersive-vr')` répond oui, il crée le moteur avec `forceWebGL: true`.

Conséquence à connaître pour la démonstration : **sur un poste où l'extension Immersive Web Emulator est active, la pastille de
la scène indique « WebGL 2 »**. Pour montrer WebGPU sur ce même poste, ouvrir l'adresse avec `?backend=webgpu` (le bouton VR
est alors annoncé indisponible), ou désactiver l'extension.

## Deux précautions dans le code

| Précaution | Où | Pourquoi |
| --- | --- | --- |
| `await renderer.init()` avant tout dessin | `createScene()` | l'accès à la carte graphique est asynchrone en WebGPU |
| framebuffer `null` toléré | `tolerateDefaultFramebuffer()` | un émulateur dessine dans le canevas de la page (framebuffer `null`) ; le moteur WebGL 2 de r187 ne l'accepte pas tel quel et lèverait une erreur à chaque image |

## Protocole de test (à refaire à chaque changement de version de Three.js)

Poste : Chrome récent sur PC, site servi sur `http://localhost:8080` ou sur GitHub Pages (WebGPU et WebXR exigent un contexte sécurisé).

**A. WebGPU, sans émulateur** (extension Immersive Web Emulator désactivée)

1. Ouvrir l'application : la pastille en bas à droite de la scène indique « WebGPU ». La console affiche `[rendu] moteur : WebGPU`.
2. La topologie, les étiquettes et les paquets s'affichent ; lecture, pause, sélection à la souris fonctionnent.
3. Ouvrir `?backend=webgl` : la pastille indique « WebGL 2 », l'affichage est identique.

**B. VR, avec l'émulateur** (extension activée, page rechargée)

4. La pastille indique « WebGL 2 » et le bouton « Entrer en VR » est actif.
5. Entrer en VR : la topologie et le panneau s'affichent ; dans l'onglet WebXR des outils de développement, la tête et les manettes bougent.
6. Gâchette sur un bouton du panneau, puis sur un équipement.
7. Quitter la session : retour au mode classique, la souris fonctionne à nouveau.

## Résultats relevés

| Date | Navigateur | Carte graphique | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Testeur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| *à remplir* | Chrome … | | | | | | | | | Ayoub |

> Ce tableau se remplit sur le poste de test : noter « OK » ou le message d'erreur exact.
>
> Vérifications automatiques déjà faites (Chrome sans écran, rendu logiciel) : avec WebGPU, la scène complète est bien dessinée
> (image relue depuis une cible de rendu) ; sans WebGPU, le secours WebGL 2 s'active seul ; avec un casque Meta Quest 3 simulé
> (IWER), les étapes 4 à 7 passent. L'affichage de WebGPU à l'écran sur une vraie carte graphique reste à constater en A.
