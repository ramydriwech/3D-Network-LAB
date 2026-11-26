# Tests sur appareils

Tâche n° 63 (S6) : tester l'application sur un PC et sur deux smartphones, puis corriger les problèmes d'affichage.
Ce document est la **fiche de test** : la remplir sur chaque appareil, noter « OK » ou décrire le problème.

## Appareils testés

| | Appareil | Système | Navigateur et version | Taille d'écran | Testeur | Date |
| --- | --- | --- | --- | --- | --- | --- |
| A | PC | | Chrome | | | |
| B | Smartphone 1 | | | | | |
| C | Smartphone 2 | | | | | |

## Liste de vérification

| # | Vérification | A | B | C |
| --- | --- | --- | --- | --- |
| 1 | La page s'ouvre par l'URL GitHub Pages, sans erreur dans la console | | | |
| 2 | La topologie est entièrement visible au chargement (aucun équipement coupé) | | | |
| 3 | Tourner, zoomer, déplacer la vue (souris / un doigt, pincement, deux doigts) | | | |
| 4 | Toucher un équipement le sélectionne ; un glissement ne sélectionne rien | | | |
| 5 | Les étiquettes (noms, IP, ports) sont lisibles | | | |
| 6 | Lecture, Pause, Pas à pas, Vitesse, Réinitialiser | | | |
| 7 | Scénario Ping joué en entier : animation fluide | | | |
| 8 | Scénario HTTP (le plus chargé) joué en vitesse ×4 : pas de saccade gênante | | | |
| 9 | Toucher un paquet à l'arrêt ouvre l'inspecteur | | | |
| 10 | Les panneaux défilent sous la scène ; aucun texte ne déborde | | | |
| 11 | Rotation de l'écran : la scène se redimensionne | | | |
| 12 | Changement de langue FR / EN | | | |
| 13 | Installation de la PWA, ouverture depuis l'écran d'accueil | | | |
| 14 | Mode avion après une première visite : l'application se recharge | | | |

## Problèmes trouvés et corrections

| # | Appareil | Problème | Correction | Fichier |
| --- | --- | --- | --- | --- |
| 1 | écran étroit ou en portrait (émulation 390 × 800) | les équipements des extrémités sortaient du cadre | la caméra recule selon le rapport largeur/hauteur de la scène | `src/render/scene.js` (`frame`) |
| 2 | mobile (préventif) | risque : canevas resté à l'ancienne taille après une rotation de l'écran | écoute de `orientationchange` | `src/render/scene.js` |
| 3 | mobile (préventif) | risque : contexte graphique perdu après une mise en veille (moteur de secours WebGL 2) | `webglcontextlost` intercepté pour permettre la restauration | `src/render/scene.js` |
| | | *ajouter ici les problèmes relevés sur les vrais appareils* | | |

La ligne 1 a été constatée en émulation sur PC (fenêtre de 390 × 800 pixels, écran tactile simulé) ; les lignes 2 et 3
sont des précautions. Rien de cela ne remplace les essais sur de vrais téléphones, que ce tableau attend encore.
