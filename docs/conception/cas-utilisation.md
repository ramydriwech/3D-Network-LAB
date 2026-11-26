# Diagramme de cas d'utilisation

```mermaid
flowchart LR
  etu(["👤 Étudiant"])
  ens(["👤 Enseignant"])
  jury(["👤 Jury / superviseur"])

  subgraph app["3D Network Topology"]
    direction TB
    uc1(["Ouvrir l'application par son URL"])
    uc2(["Installer la PWA (facultatif)"])
    uc3(["Explorer la topologie 3D"])
    uc4(["Choisir un scénario de protocole"])
    uc5(["Piloter la simulation : lecture, pause, pas à pas, vitesse, réinitialisation"])
    uc6(["Lire l'explication de chaque étape"])
    uc7(["Sélectionner un équipement et lire ses tables"])
    uc8(["Lancer un ping entre deux hôtes"])
    uc9(["Inspecter un paquet"])
    uc10(["Explorer la scène en VR"])
    uc11(["Utiliser l'application hors ligne"])
    uc12(["Changer de langue (FR / EN)"])
    uc13(["Comparer des débits et observer la charge des liens"])
    uc14(["Diagnostiquer le réseau et appliquer une correction"])
    uc15(["Construire, enregistrer et partager sa propre topologie"])
  end

  etu --> uc1 & uc2 & uc3 & uc4 & uc5 & uc7 & uc9 & uc10 & uc11 & uc12
  ens --> uc1 & uc4 & uc5 & uc8
  jury --> uc1 & uc2 & uc10 & uc11

  uc5 -. inclut .-> uc6
  uc8 -. étend .-> uc7
  uc9 -. étend .-> uc5
  uc11 -. nécessite une première visite .-> uc1
  etu --> uc13
  etu --> uc14
  ens --> uc14
  etu --> uc15
  ens --> uc15
  uc15 -. inclut .-> uc14
```

## Acteurs

| Acteur | Ce qu'il cherche |
| --- | --- |
| **Étudiant** (acteur principal) | comprendre un protocole en le regardant fonctionner, à son rythme |
| **Enseignant** | montrer un échange en cours ou en TD, lancer un ping entre deux hôtes choisis |
| **Jury / superviseur** | vérifier la démonstration : accès par URL, installation, VR émulée, hors ligne |

## Cas d'utilisation et fonctionnalités du cahier des charges

| Cas d'utilisation | Fonctionnalité | Précondition | Résultat observable |
| --- | --- | --- | --- |
| Ouvrir l'application par son URL | F07 | navigateur récent, connexion | la topologie s'affiche, sans installation |
| Installer la PWA | F07 | Chrome/Edge, HTTPS | icône sur l'appareil ; un refus n'empêche rien |
| Explorer la topologie 3D | F01 | — | rotation, zoom, déplacement à la souris ou au doigt |
| Choisir un scénario | F03, F04 | — | nouvelle topologie, explications du scénario |
| Piloter la simulation | F06 | scénario chargé | les paquets avancent, se figent ou repartent |
| Lire l'explication de chaque étape | F02 | simulation lancée | texte mis à jour à chaque message |
| Sélectionner un équipement | F01, F05 | — | nom, IP, MAC, cache ARP, table MAC ou de routage |
| Lancer un ping entre deux hôtes | F03 | deux hôtes sélectionnés | ARP puis ICMP entre ces deux hôtes |
| Inspecter un paquet | F05 | un paquet affiché | MAC, IP, TTL, ports, indicateurs, contenu |
| Explorer la scène en VR | F08 | casque ou Immersive Web Emulator | session immersive, panneau 3D ; sinon mode classique |
| Utiliser l'application hors ligne | F07 | une première visite connectée | rechargement sans réseau |
| Comparer des débits | superviseur | scénario « Débit » | durée et débit utile de chaque transfert, câbles colorés selon la charge, fiche technique |
| Diagnostiquer le réseau | superviseur | scénario chargé | liste des problèmes avec cause et conseil ; correction en un clic |
| Construire sa topologie | superviseur | onglet Construire | réseau ajouté, câblé, adressé, joué ; enregistré, exporté ou importé |
