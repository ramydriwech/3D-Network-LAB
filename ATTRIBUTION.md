# Origine des ressources (attribution)

Projet **3D Network Topology** — SUP'COM, département SIA, 2026/2027.
Équipe : Rami Driouech, Mohamed Aziz Saoudi, Khalil Krifa, Ayoub Ben Sabbeh.
Superviseur : Dr. Eng. Mohamed Becha Kaaniche.

Ce fichier dit d'où vient chaque chose livrée avec l'application. Il est mis à jour dans la
même pull request que toute ressource, bibliothèque ou aide extérieure ajoutée.

## 1. Bibliothèques

| Élément | Origine | Licence | Utilisation |
|---|---|---|---|
| Three.js r187 (`vendor/three/`) | paquet npm `three@0.187.0`, fichiers de `build/` et `examples/jsm/` copiés sans modification | MIT (`vendor/three/LICENSE`) | rendu 3D WebGPU (et son repli WebGL 2), OrbitControls, chargeur GLTF |

Aucune autre bibliothèque n'est chargée par le navigateur. Les outils (`tools/*.mjs`) et les
tests (`tests/*.test.js`) n'utilisent que Node.js (≥ 20) et son lanceur de tests intégré.

Pour les essais en VR sans casque, l'équipe utilise l'extension **Immersive Web Emulator**
(Meta, licence MIT) dans Chrome, ou sa bibliothèque **IWER** dans les tests automatisés ;
aucun de ces deux outils n'est livré avec l'application.

## 2. Modèles 3D, icônes et images

| Élément | Origine |
|---|---|
| `assets/models/*.glb` (PC, serveur, switch, routeur) | **générés par le script** `tools/make-models.mjs` (formes simples, matériaux sans texture) |
| `assets/icons/*` | **dessinés par le script** `tools/make-icons.mjs` et à la main (`favicon.svg`) |
| Câbles, paquets, étiquettes, panneaux VR, sol | dessinés par le code (`src/render/`, `src/xr/`) avec les primitives de Three.js |
| Maquette d'interface (`docs/conception/maquette.svg`) | dessinée par l'équipe |

Aucun modèle, texture, image, police ou son externe n'est utilisé ; le texte s'affiche avec
les polices du système.

## 3. Données

| Élément | Origine |
|---|---|
| Catalogue des équipements et câbles (`src/sim/catalog.js`) | modèles **génériques et fictifs** (« CX-24G », « RX-2G »…). Les vitesses sont les vitesses Ethernet normalisées ; les caractéristiques (capacité de commutation, débit de transfert) sont **calculées** à partir des ports, pas recopiées d'une fiche constructeur. Aucune marque. |
| Portées et vitesses des câbles (Cat 5 à Cat 6a, fibre OM3) | valeurs usuelles des normes TIA/ISO (100 m en cuivre, 10 Gb/s sur 55 m en Cat 6, 300 m en OM3) |
| Adresses MAC des scénarios | adresses « administrées localement » (préfixe `02:`), d'aucun constructeur |
| Adresses IP | plages privées (RFC 1918) et réseau de documentation IPv6 `2001:db8::/32` (RFC 3849) |
| Scénarios (`scenarios/*.json`) et textes pédagogiques | écrits par l'équipe |

## 4. Aide extérieure

- **Assistant IA (Claude, Anthropic)** : utilisé pendant le projet pour proposer du code, des
  tests et de la documentation, en particulier pour les compléments demandés par le
  superviseur en S5–S7 (débit, diagnostic, éditeur, VR en WebGPU). Chaque proposition a été
  relue, testée (`npm test`, essais navigateur et émulateur VR) et intégrée par le membre
  responsable de la partie concernée, par une pull request relue par un autre membre.
- **Version précédente du dépôt de l'équipe** : la liste des fonctionnalités à ajouter (débit,
  diagnostic, éditeur, scénarios ARP / TTL, vérification HTTPS) a été reprise d'une version
  antérieure du projet de l'équipe. Le code a été **réécrit** dans l'architecture actuelle
  (contrats, bus d'évènements, gardes de semaine), sans copie.
- **Normes et documents publics** consultés pour les comportements simulés : RFC 826 (ARP),
  RFC 792 (ICMP), RFC 768 (UDP), RFC 9293 (TCP, dont fenêtre, ACK dupliqués et
  retransmission rapide de la RFC 5681), RFC 1034/1035 (DNS), RFC 2131 (DHCP), RFC 9110
  (HTTP), RFC 4861 (découverte de voisins IPv6), spécifications W3C WebXR et WebGPU.
