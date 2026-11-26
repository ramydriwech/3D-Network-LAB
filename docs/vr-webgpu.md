# La VR avec WebGPU

> Application 100 % WebGPU, VR comprise : aucun rendu WebGL. Code : `src/xr/gpuBridge.mjs`,
> `src/xr/session.mjs`, `src/xr/controllers.mjs`, `src/xr/vrInfoPanel.mjs`.

## Le problème

WebXR a été conçu avec WebGL : la session dessine dans un « calque » `XRWebGLLayer` qui exige
un contexte WebGL. Jusqu'en S6, l'application basculait donc tout le rendu en WebGL 2 dès
qu'un casque ou un émulateur était détecté. Aujourd'hui, la VR passe entièrement par WebGPU, et
l'application n'a plus de moteur WebGL du tout ([choix-moteur-rendu.md](choix-moteur-rendu.md)).

## Deux voies, essayées dans l'ordre

| Voie | Quand | Comment |
|---|---|---|
| **native** | le navigateur expose `XRGPUBinding` et accorde la fonctionnalité `webgpu` | Three.js r187 dessine directement dans les textures du casque (`renderer.xr.setSession`) |
| **pont** | émulateurs (Immersive Web Emulator, IWER) | WebGPU dessine dans le canevas de la page ; notre boucle XR lit la pose de la tête et des manettes et rend une caméra par œil (`ArrayCamera`) |

Le **pont** fonctionne parce qu'un émulateur affiche justement le canevas de la page. La
session réclame un calque : on lui donne une simple surface qui décrit le canevas, sans
jamais créer de contexte WebGL (vérifié : zéro contexte WebGL pendant une session).

Un vrai casque dont le navigateur n'a pas encore `XRGPUBinding` refuse cette surface : la
session est refermée et un message explique quoi faire (activer WebXR-WebGPU dans les
réglages expérimentaux du navigateur du casque). Il n'y a pas de voie de secours WebGL : pour la
démonstration sur un vrai casque, vérifier d'abord que son navigateur propose `XRGPUBinding` : panneau
« Technologies » (clic sur la pastille « WebGPU »), ligne « VR sur cet appareil ».

## Ce qui change dans le code

- `render.runFrame(time, draw)` : le corps de la boucle (simulation, modules, dessin) est
  partagé entre la boucle normale et la boucle du pont.
- `render.isPresenting()` remplace `renderer.xr.isPresenting` (vrai pour les deux voies).
- Les manettes viennent d'un « rig » : `renderer.xr` ou celui du pont, avec la même interface
  `getController(i)` et le même évènement `select`.
- Tolérance de visée : un équipement de la maquette visé à moins de 3° est sélectionné.
- Panneau de droite : onglets Étape, Fiche (fiche technique et ports en direct), Diagnostic
  (avec « Corriger »).

## Vérification (`docs/tests-appareils.md`)

Chrome sans écran, WebGPU logiciel (SwiftShader), IWER (Meta Quest 3 émulé) : entrée en VR
en voie « pont », images rendues en continu, gâchette sur les boutons des deux panneaux,
sélection d'un équipement, correction depuis le panneau Diagnostic, sortie avec caméra
restaurée.
