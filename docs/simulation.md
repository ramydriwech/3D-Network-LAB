# La simulation

Ce document explique comment fonctionne le moteur (`simulation.js`, `src/sim/`) et comment y ajouter un protocole
ou un scénario. Les protocoles eux-mêmes sont décrits dans [protocoles/](protocoles/).

## 1. Une simulation à évènements discrets

La simulation n'avance pas « image par image » : c'est une **file d'évènements triée par date**, en millisecondes de
temps simulé. L'horloge saute d'un évènement au suivant.

```
t = 0      PC1 décide d'envoyer une requête ARP
t = 200    la trame quitte PC1          → publie packet:send
t = 1200   la trame arrive à SW1        → publie packet:receive ; SW1 décide de l'inonder
t = 1400   la trame quitte SW1 par p2 et p3
…
```

Conséquences :

- **Déterminisme** : la même suite d'actions donne toujours la même suite d'évènements. Les scénarios se testent
  donc sans navigateur, avec `node --test`.
- **Indépendance du nombre d'images par seconde** : un téléphone lent affiche exactement la même simulation qu'un PC
  rapide, avec moins d'images. Le rendu se contente de lire `sim.now` pour placer les paquets.
- **La vitesse est un simple facteur** : `engine.tick(dt)` avance l'horloge de `dt × vitesse`.

Deux durées fixent le rythme (dans `src/sim/events.js`) : `HOP_DURATION = 1000` ms pour traverser un câble,
`PROCESS_DELAY = 200` ms de traitement avant d'émettre.

## 2. Les modules

| Fichier | Rôle |
| --- | --- |
| `simulation.js` | façade : assemble tout, seul point d'entrée du reste de l'application |
| `src/sim/engine.js` | file d'évènements, horloge, vitesse, pas à pas |
| `src/sim/state.js` | états prêt / lecture / pause / terminé (patron State) |
| `src/sim/commands.js` | commandes (patron Command) |
| `src/sim/eventBus.js` | bus d'évènements (patron Observer) |
| `src/sim/events.js` | **contrat** : sujets du bus, forme d'un paquet, contrat d'un protocole |
| `src/sim/scenario.js` | **contrat** : validation et chargement d'un scénario |
| `src/sim/registry.js` | registre des protocoles (patron Strategy), chargés à la demande |
| `src/sim/network.js` | équipements, câbles, circulation des trames |
| `src/sim/addr.js` | calculs d'adresses MAC et IPv4 |
| `src/sim/devices/` | comportement d'un hôte, d'un routeur, d'un switch (patron Factory) |
| `src/sim/protocols/` | un fichier par protocole |
| `src/sim/mockEngine.js` | fausse simulation pour développer l'interface seule |

## 3. Le trajet d'un paquet

`Network.transmit(device, iface, packet, notes)` programme deux évènements :

1. **le départ**, après le temps de traitement : publication de `packet:send` (le rendu crée le paquet 3D, le journal ajoute une ligne) ;
2. **l'arrivée**, une traversée de câble plus tard : l'équipement d'en face reçoit la trame (`device.receive()`),
   puis `packet:receive` est publié avec `accepted` et les explications de l'équipement.

Règle métier : **une interface n'émet qu'une trame à la fois**. Si une trame est déjà en route sur le câble dans ce
sens, la suivante attend ; deux paquets ne se superposent donc jamais à l'écran.

À la réception, un hôte ou un routeur (`IpNode.receive()`) filtre d'abord sur l'adresse MAC, puis remet le paquet au
protocole qui s'est branché sur ce type de message : `eth:ARP`, `ip:ICMP`, `ip:UDP`, `ip:TCP`…

## 4. Pas à pas

L'arrivée d'un paquet est marquée « frontière » (`boundary`). La commande `step` relance la lecture jusqu'à la
prochaine frontière puis remet la simulation en pause : on avance donc **d'une arrivée de paquet à la suivante**, ce
qui correspond à une explication à lire. Tous les évènements de même date forment un seul instant (une diffusion
recopiée sur trois câbles arrive en une seule fois).

## 5. Étapes d'un scénario et réinitialisation

Quand la file est vide, le moteur demande la suite (`engine.onIdle`) : la simulation lance l'étape suivante du
scénario après 600 ms. Quand il n'y a plus d'étape, l'état passe à « terminé ».

`reset` reconstruit le réseau (`new Network(…)`) : caches ARP, tables MAC, connexions TCP et adresses obtenues par
DHCP repartent de zéro.

## 6. Ajouter un protocole

1. Créer `src/sim/protocols/<id>.js` qui exporte par défaut un objet conforme au contrat ([contrats.md](contrats.md), § 4).
2. Dans `install(device, net)`, brancher les réceptions : `device.on('ip:MONPROTO', (packet, iface) => …)`.
3. Émettre avec `device.sendIp({ dst, proto, protocol, label, explain, … })` : le choix de la route, ARP et la trame Ethernet sont pris en charge.
4. Écrire un texte `{ fr, en }` pour chaque explication dans `texts`.
5. Si la famille de paquets est nouvelle, l'ajouter à `PROTOCOL_IDS` (contrat : pull request à quatre) et lui donner une couleur dans `src/render/packetStyles.js`.
6. Écrire le scénario, l'ajouter à `scenarios/index.json`, écrire les tests.

Aucune autre modification : ni le moteur, ni l'interface, ni le rendu ne connaissent la liste des protocoles.

## 7. Tests

| Fichier | Vérifie |
| --- | --- |
| `tests/contrats.test.js` | adresses, format des scénarios, forme des paquets, contrat des protocoles, commandes, mock |
| `tests/engine.test.js`, `tests/eventBus.test.js` | ordre des évènements, vitesse, pas à pas, états, bus |
| `tests/<protocole>.test.js` | la suite exacte des messages de chaque protocole et ses cas d'erreur |
| `tests/regression.test.js` | chaque scénario du catalogue, comparé à sa trace de référence (`tests/golden/`) ; déterminisme ; textes fr/en présents |

Après un changement **voulu** du comportement : `UPDATE_GOLDEN=1 node --test tests/regression.test.js`, puis relire le diff des fichiers `tests/golden/`.

## 8. Simplifications assumées

Le projet simule les échanges pour l'apprentissage ; il ne reproduit pas une pile réseau complète. Pas de pertes ni
de collisions, pas de somme de contrôle, pas de fragmentation, des délais identiques sur tous les câbles, des caches
qui n'expirent pas. Chaque protocole liste ses propres simplifications en tête de son fichier et dans sa page de documentation.
