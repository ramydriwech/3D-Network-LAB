# Cahier conceptuel

**3D network topology** — Projet WebXR & Spatial Computing, SUP'COM, département SIA.
Équipe : Mohamed Aziz Saoudi, Ayoub Ben Sabbeh, Khalil Krifa, Rami Driouech. Superviseur : Dr. Eng. Mohamed Becha Kaaniche.

Ce cahier rassemble l'analyse des besoins et les diagrammes de conception. Chaque diagramme est tenu à jour par
son auteur dans `docs/conception/` ; ce document les relie et en donne la lecture d'ensemble.

| Diagramme | Fichier | Auteur |
| --- | --- | --- |
| Maquette de l'interface | [conception/maquette.md](conception/maquette.md) | Ramy |
| Cas d'utilisation | [conception/cas-utilisation.md](conception/cas-utilisation.md) | Ramy |
| Séquence du ping | [conception/sequence-ping.md](conception/sequence-ping.md) | Aziz |
| Classes | [conception/classes.md](conception/classes.md) | Khalil |
| Déploiement | [conception/deploiement.md](conception/deploiement.md) | Ayoub |

## 1. Le besoin

**Problématique.** Les schémas statiques expliquent mal les échanges entre protocoles, le trajet des paquets et le
rôle des équipements ; les simulateurs spécialisés demandent une installation qui freine la découverte.

**Réponse.** Une application web qui montre les messages circuler dans une topologie 3D, pas à pas, avec une
explication pour chaque message — accessible par un simple lien, sans installation ni matériel XR.

### Utilisateurs

| Utilisateur | Contexte | Attente principale |
| --- | --- | --- |
| Étudiant du cycle ingénieur | révision autonome, travaux dirigés | comprendre un protocole à son rythme |
| Enseignant | cours, TD | montrer un échange et le commenter |
| Superviseur, jury | évaluation | constater la démonstration du cahier des charges |

### Exigences fonctionnelles

| Réf. | Exigence | Priorité | État |
| --- | --- | --- | --- |
| F01 | charger des topologies JSON et les explorer en 3D (souris, toucher) | Essentiel | réalisé |
| F02 | animer les messages et les expliquer étape par étape | Essentiel | réalisé |
| F03 | simuler ARP et ICMP, puis DNS, DHCP, TCP, UDP | Prioritaire | réalisé |
| F04 | HTTP/HTTPS, commutation, VLAN, routage statique | Progressif | HTTP, commutation et routage réalisés ; HTTPS expliqué, VLAN non réalisé |
| F05 | inspecter les paquets (MAC, IP, ports, TTL, indicateurs, contenu) | Essentiel | réalisé |
| F06 | lecture, pause, pas à pas, vitesse, réinitialisation | Essentiel | réalisé |
| F07 | accès par URL, installation PWA facultative, cache | Essentiel | réalisé |
| F08 | mode classique PC/mobile et VR par WebXR et émulateur | Essentiel | réalisé |
| F09 | extensions du catalogue | Extension | IPv6 simplifié réalisé |
| F10 | AR par hit testing | Option | non réalisé |

### Exigences non fonctionnelles

| Exigence | Traduction dans la conception |
| --- | --- |
| aucun service payant, outils libres | GitHub Pages, GitHub Actions, Three.js (MIT), aucune autre dépendance |
| site statique, sans backend | fichiers HTML/CSS/JS/JSON ; scénarios chargés par `fetch` |
| HTTPS en production | GitHub Pages ; `localhost` en développement |
| fonctionne sous le chemin du dépôt | chemins relatifs partout |
| utilisable sans casque | mode classique complet ; VR vérifiée dans l'émulateur ; repli automatique |
| hors ligne après une première visite | Service Worker et liste de cache générée |
| fluide sur mobile | modèles légers, ressources partagées, nombre de paquets plafonné |
| quatre développeurs en parallèle | contrats communs fixés en S1, un propriétaire par fichier |

## 2. Cas d'utilisation

Voir [conception/cas-utilisation.md](conception/cas-utilisation.md). Douze cas, regroupés en quatre familles :
**accéder** (ouvrir par URL, installer, hors ligne), **explorer** (naviguer en 3D, sélectionner un équipement, VR),
**simuler** (choisir un scénario, piloter, lancer un ping) et **comprendre** (lire les explications, inspecter un paquet).

## 3. Dynamique : la séquence du ping

Voir [conception/sequence-ping.md](conception/sequence-ping.md). C'est le scénario de référence de la démonstration :
il fait intervenir ARP, la commutation, ICMP puis le routage, et montre les trois idées que l'application veut faire
comprendre — la diffusion contre l'unicast, l'apprentissage du switch, le rôle de la passerelle.

## 4. Structure : le diagramme de classes

Voir [conception/classes.md](conception/classes.md). La simulation est organisée autour de cinq patrons de conception :

| Patron | Rôle dans l'application |
| --- | --- |
| Observer | le bus d'évènements synchronise l'interface et la scène avec la simulation |
| Command | lecture, pause, pas à pas, vitesse et réinitialisation, partagées par les boutons, le clavier et la VR |
| Strategy | un fichier par protocole, choisi d'après son identifiant |
| Factory | création des équipements (comportement et modèle 3D) à partir du JSON |
| State | états prêt, lecture, pause, terminé |

## 5. Déploiement

Voir [conception/deploiement.md](conception/deploiement.md). Le dépôt GitHub est la source ; GitHub Actions teste et
publie ; GitHub Pages sert le site en HTTPS ; tout le reste s'exécute dans le navigateur de l'utilisateur, où le
Service Worker garde une copie pour l'usage hors ligne.

## 6. Interface

Voir [conception/maquette.md](conception/maquette.md). L'écran est découpé en zones réservées, une par module, ce qui
a permis de développer l'interface, la scène et la VR sans conflit.

## 7. Concepts clés

| Concept | Utilisation |
| --- | --- |
| WebGPU | rendu classique par `WebGPURenderer` ; WebGL 2 en secours et pour la VR (`src/render/scene.js`) |
| Session XR | entrée et sortie du mode `immersive-vr` (`src/xr/session.js`) |
| Raycasting | sélection d'un équipement ou d'un paquet, à la souris, au doigt ou à la manette (`pick()`) |
| Évènements discrets | simulation déterministe, indépendante des images affichées (`src/sim/engine.js`) |
| JSON | description des topologies et des scénarios (`scenarios/`) |
| PWA | manifest pour l'installation, Service Worker pour le cache |
| Hit testing (option) | non réalisé |

## 8. Validation

Le plan de démonstration du cahier des charges (six étapes) sert de recette. Chaque étape correspond à une section
du [manuel utilisateur](manuel.md) :

| Étape de la démonstration | Section du manuel |
| --- | --- |
| 1. Ouvrir l'URL HTTPS | § 1 |
| 2. Installer la PWA ; un refus n'empêche rien | § 7 |
| 3. Explorer, sélectionner deux hôtes, lancer un ping | § 2 et § 4 |
| 4. ARP puis ICMP, pause, pas à pas, inspection ; autre scénario | § 3 et § 6 |
| 5. Vitesse, réinitialisation, rechargement hors ligne | § 3 et § 7 |
| 6. VR émulée, sortie, repli classique | § 8 |

Les tests automatiques (`npm test`) vérifient la cohérence des protocoles ; les fiches
[tests-appareils.md](tests-appareils.md) et [lighthouse.md](lighthouse.md) portent sur les appareils et la qualité PWA.

Documentation technique : [architecture.md](architecture.md).
