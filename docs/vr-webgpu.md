# La VR avec WebGPU

> Demande de l'enseignant : WebGPU partout, VR comprise (S7). Code : `src/xr/gpuBridge.js`,
> `src/xr/session.js`, `src/xr/controllers.js`, `src/xr/vrInfoPanel.js`.

## Le problème

WebXR a été conçu avec WebGL : la session dessine dans un « calque » `XRWebGLLayer` qui exige
un contexte WebGL. Jusqu'en S6, l'application basculait donc tout le rendu en WebGL 2 dès
qu'un casque ou un émulateur était détecté.

## Trois voies, essayées dans l'ordre

| Voie | Quand | Comment |
|---|---|---|
| **native** | le navigateur expose `XRGPUBinding` et accorde la fonctionnalité `webgpu` | Three.js r187 dessine directement dans les textures du casque (`renderer.xr.setSession`) |
| **pont** | émulateurs (Immersive Web Emulator, IWER) | WebGPU dessine dans le canevas de la page ; notre boucle XR lit la pose de la tête et des manettes et rend une caméra par œil (`ArrayCamera`) |
| **webgl** | moteur WebGL 2 (WebGPU absent, ou `?backend=webgl`) | voie classique de Three.js, inchangée |

Le **pont** fonctionne parce qu'un émulateur affiche justement le canevas de la page. La
session réclame un calque : on lui donne une simple surface qui décrit le canevas, sans
jamais créer de contexte WebGL (vérifié : zéro contexte WebGL pendant une session).

Un vrai casque dont le navigateur n'a pas encore `XRGPUBinding` refuse cette surface : la
session est refermée et un message explique quoi faire (activer WebXR-WebGPU dans les
réglages expérimentaux, ou recharger avec `?backend=webgl`).

## Ce qui change dans le code

- `render.runFrame(time, draw)` : le corps de la boucle (simulation, modules, dessin) est
  partagé entre la boucle normale et la boucle du pont.
- `render.isPresenting()` remplace `renderer.xr.isPresenting` (vrai pour les trois voies).
- Les manettes viennent d'un « rig » : `renderer.xr` ou celui du pont, avec la même interface
  `getController(i)` et le même évènement `select`.
- Tolérance de visée : un équipement de la maquette visé à moins de 3° est sélectionné.
- Panneau de droite : onglets Étape, Fiche (fiche technique et ports en direct), Diagnostic
  (avec « Corriger »).

## Vérification (`docs/tests-appareils.md`)

Chrome sans écran, WebGPU logiciel (SwiftShader), IWER (Meta Quest 3 émulé) : entrée en VR
en voie « pont », images rendues en continu, gâchette sur les boutons des deux panneaux,
sélection d'un équipement, correction depuis le panneau Diagnostic, sortie avec caméra
restaurée. Même parcours avec `?backend=webgl` (voie « webgl »).
