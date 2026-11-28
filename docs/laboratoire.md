# Le laboratoire de Steve

> Demande du superviseur (S6–S7). Persona : **Steve**, étudiant en réseaux, entre dans un laboratoire où des
> switchs, des routeurs, des pare-feu et des serveurs sont montés dans des baies et des PC posés sur des postes de travail. Il peut jouer les
> montages tout prêts, en construire de nouveaux et configurer chaque équipement avec ses propres commandes, à
> l'écran ou dans un casque de réalité virtuelle.

## 1. Le parcours de Steve

1. Il ouvre l'application : il est directement dans la salle (en VR, avec **Entrer en VR**, à l'échelle réelle).
   Pour voir d'un coup d'œil qui est relié à qui, il passe en **Mode classique** (bouton en haut à droite de la scène, à côté de « Survol », ou
   touche **L**) : une vue d'ensemble de la topologie, aux équipements, câbles et paquets agrandis ; **Retour au
   labo** (ou **L**) le ramène dans la salle.
2. Il arrive par la porte. Sur le tableau blanc du fond : le titre et la consigne du montage en cours. Autour de lui,
   une vraie salle réseau : faux plancher technique, baies 19 pouces, postes de travail, chemins de câbles au
   plafond où courent les câbles du montage.
3. Il s'approche d'un équipement : le viseur affiche sa **fiche** (nom, modèle, système, adresses).
4. Il appuie sur **E** : la **console** de l'équipement s'ouvre (fenêtre en bas à gauche ; en VR, un pupitre avec un
   clavier 3D). Il tape ses commandes ; le réseau change vraiment.
5. Il lance un `ping` : les paquets partent dans la salle, le résultat s'affiche dans la console.
6. Il veut un autre montage : il le **construit à la main**, comme dans une vraie salle (partie 2 bis) — il pose les
   meubles, installe chaque équipement sur le bon meuble, puis branche les câbles prise par prise — et le configure.
7. Pour s'entraîner, l'onglet **Missions** propose six exercices guidés, de la prise en main au réseau construit de
   zéro.

## 2. Les commandes de déplacement

| Écran | Touches / gestes |
| --- | --- |
| Ordinateur | **ZQSD** ou **WASD** ou flèches : marcher · **Maj** : plus vite · **souris** : regarder (cliquer d'abord dans la scène) · **clic** : choisir l'objet visé, ou prendre / poser / installer / brancher · **F** : prendre ce qui est visé (ou débrancher la prise visée), reposer ce qu'on a en main · **R** : tourner le meuble porté · **Suppr** : retirer du réseau ce qu'on a en main · **E** : console · **V** : survol / marche · **B** : onglet Construire · **L** : mode classique · **Échap** : libérer la souris |
| Écran tactile | **joystick** en bas à gauche : marcher · **glisser** : regarder · **toucher** un objet : le choisir (ou poser, brancher) · boutons **Console**, **Choisir**, **Prendre** (F) et **Tourner** (R) |
| Casque VR | **gâchette** sur le sol : se téléporter (un anneau montre l'arrivée) · gâchette sur un équipement : sa console · gâchette sur une étagère : prendre le modèle, le meuble ou le câble ; les mains pleines : poser, installer, brancher (le rayon sert de viseur, le meuble se pose où il touche le sol) · **poignée latérale** (grip) : reprendre ce qui est visé, débrancher, reposer · **joystick gauche/droite** : tourner de 30° |

La vue **Survol** (V, ou bouton en haut à droite de la scène) montre toute la salle d'en haut, avec la navigation
habituelle à la souris : les murs disparaissent d'eux-mêmes quand on les regarde de l'extérieur.

## 2 bis. Construire la salle à la main

Steve monte son réseau comme dans une vraie salle. Il a des **mains** humaines (vue à la première personne : doigts
articulés, ongles, poignets, manches de blouse) : elles poussent un meuble, paumes ouvertes ; elles saisissent un switch, un
routeur ou un serveur **par ses côtés**, doigts repliés dessous, sans jamais entrer dedans ; un **PC** se porte
en entier (écran, tour, clavier), tenu par ses côtés. Ce que Steve prend **glisse** de l'étagère (ou de
son meuble) jusqu'à ses mains, et à la pose il glisse de ses mains jusqu'à sa place. Pour câbler, le rouleau (ses spires
tournées vers Steve) est dans la main gauche, la fiche pincée entre le pouce et l'index de la droite, et le câble va,
continu, du rouleau à la fiche ; une fois le premier bout branché, il part de la prise et revient au rouleau.

Les deux étagères, contre le mur de droite : **« Équipements »** (un exemplaire de chaque modèle, et la planche des
câbles) et **« Mobilier »** (les quatre meubles, en maquettes à la même échelle). L'enseigne au-dessus de la porte :
« 3D-Network-LAB ».

| Geste | Comment | Ce qui se passe |
| --- | --- | --- |
| **Poser un meuble** | Étagère **« Mobilier »** (côté porte) : un clic prend une **baie 19 pouces 12U**, une **baie basse 6U**, un **poste de travail** (bureau et fauteuil) ou une **table de laboratoire** | sa silhouette suit le regard au sol, **verte** si la place est libre, **rouge** sinon (trop près d'un mur, devant la porte ou les étagères, sur un autre meuble) ; sa façade reste tournée vers Steve, **R** ajoute un quart de tour ; un clic le pose |
| **Installer un équipement** | Étagère **« Équipements »** : un clic met le modèle dans les mains ; Steve marche jusqu'au meuble qui convient et le vise | baie pour un équipement de baie (switch 24 ports, routeur, pare-feu de baie, serveur 2U) : l'**emplacement U** visé s'allume (vert : libre, rouge : occupé) ; **poste de travail** pour un PC ; boîtier de bureau (petit switch, petit pare-feu) : dans une **baie**, posé sur une tablette, ou sur une moitié de **table**. Un clic l'installe ; la fiche dit « SW1 installé : Baie 1 · U5 » |
| **Brancher un câble** | Planche des câbles : un clic prend un câble (Cat 5 à fibre OM3) | on vise une **prise précise** — la fiche dit « SW1 · GigabitEthernet0/3 — libre » — et un clic branche le premier bout : le câble pend de la prise jusqu'à la main ; on marche jusqu'à l'autre équipement et un clic branche le second : le lien relie exactement ces deux ports |
| **Débrancher** | **F** sur une prise câblée | le câble reste en main, l'autre bout toujours branché : on le rebranche ailleurs, ou **F** le range |
| **Déplacer** | **F** sur un équipement ou un meuble installé | il revient dans les mains (un équipement garde ses câbles branchés : ils le suivent) ; on le pose ailleurs, ou **F** le laisse à sa place ; **Suppr** le retire du réseau (ou de la salle, pour un meuble vide) |

Chaque geste est une modification du brouillon de l'**éditeur** : **Annuler** / **Rétablir**, l'enregistrement et
l'export JSON marchent comme pour le reste. Le plan de la salle (meubles, emplacement de chaque équipement) est
rangé dans le scénario lui-même (champ `lab`, voir [format-scenario.md](format-scenario.md)).

Les scénarios et les missions s'ouvrent avec une salle déjà équipée — un poste de travail sous chaque PC, une baie
pour chaque switch, routeur, pare-feu ou serveur, à l'endroit où il est dans la topologie —, où tout se déplace à la main. **« Nouveau réseau vide »** (onglet Construire) et la
mission « Votre réseau, de zéro » partent d'une salle vide : mobilier, puis équipements, puis câbles.

Le **mode classique** n'est pas touché : il garde le schéma logique (qui est relié à qui) ; un câble branché dans
la salle y apparaît aussitôt, un équipement ajouté dans la salle y prend une place libre près de son meuble.

## 3. Les équipements et leurs modèles

Chaque modèle a sa propre fiche (description, ports, débit, système). Elle s'affiche dans le catalogue de l'onglet
**Construire**, sur l'étagère du labo et dans le viseur. Sur l'étagère, chaque modèle est aussi grand que la place le
permet, sans dépasser sa taille dans la simulation : les PC y ont leur taille réelle.

Chaque **câble** a aussi sa fiche (catalogue : `CABLES` et `cableSummary` dans `src/sim/catalog.mjs`) : vitesse maximale,
portée et usage (« Cat 6 — jusqu'à 10 Gb/s (1 Gb/s au-delà de 55 m) · 100 m maximum »). On la voit en visant un
rouleau de l'étagère et sous la liste « Câble » de l'onglet Construire.

| Type | Modèles | Système et style de commandes |
| --- | --- | --- |
| PC | NX-1 (Gigabit), NX-0 (100 Mb/s) | invite de commandes (`ipconfig`, `ping`, `tracert`, `netsh`…) |
| Serveur | SV-2, SV-4X (10 Gb/s) | invite de commandes |
| Switch | CX-8G, CX-8F, CX-24G (non administrables, **sans console**) ; **CX-24M** (administrable) ; **VS-24** (administrable) | CX-24M : NetCore OS, style **IOS** ; VS-24 : Versa NOS, style **VRP** |
| Routeur | RX-2G, RX-4G | NetCore OS, style **IOS** |
| Routeur | **VR-2** | Versa NOS, style **VRP** |
| Pare-feu | **SG-3** (3 zones), **SG-8X** (8 interfaces) | Shield OS, style **IOS** (avec `nameif`, `security-level`, `show conn`) |

Les noms de modèles et de systèmes sont inventés : les commandes ressemblent à celles des vrais constructeurs pour
que ce qui est appris au labo serve ensuite, sans reproduire un produit précis. Référence complète : `console.md`.

## 4. Ce que le réseau sait faire (moteur)

- **VLAN 802.1Q** : ports d'accès et trunk (VLANs autorisés, VLAN natif), table MAC par VLAN.
- **Router-on-a-stick** : sous-interfaces `g0/0.10` avec `encapsulation dot1q 10`.
- **Sécurité de port** : nombre maximal d'adresses, apprentissage « sticky », violation `shutdown`
  (le port passe en *err-disabled* et le câble devient rouge foncé), `restrict` ou `protect`.
- **Listes d'accès (ACL)** étendues, nommées ou numérotées, en entrée ou en sortie, avec compteurs de correspondances.
- **NAT** statique et dynamique avec surcharge (PAT), table des traductions.
- **Pare-feu à états** : zones `inside` (100), `dmz` (50), `outside` (0) ; ce qui part d'une zone plus sûre peut
  revenir (session), le reste est refusé sauf ACL explicite.
- **Interfaces éteintes** (`shutdown`) : plus rien ne passe, le câble devient rouge foncé.

Chaque décision est expliquée dans le panneau « Ce qui se passe » (par exemple : « la réponse appartient à une
session déjà autorisée »).

## 5. Les missions

| Mission | Niveau | Situation de départ | Ce qui est vérifié |
| --- | --- | --- | --- |
| Prise en main | 1 | scénario Routage | `enable` et `show ip route` tapés sur R1, ping PC1 → PC2 réussi |
| Route de retour disparue | 2 | R2 a perdu sa route | la route sur R2, puis un ping réussi |
| VLAN erroné | 2 | le port de PC3 est dans le VLAN 10 | port dans le VLAN 20, ping de PC3 vers sa passerelle |
| Verrouiller la prise | 3 | pas de sécurité sur Gi0/1 | maximum 1, sticky, violation shutdown |
| Publier le site web | 3 | l'ACL côté Internet est vide | HTTP vers le serveur autorisé, ping toujours refusé |
| Votre réseau, de zéro | 4 | labo vide | 2 PC + 1 routeur, tout câblé, deux réseaux, diagnostic sans erreur, ping réussi |

Les objectifs se cochent seuls, quelle que soit la façon d'y arriver (console IOS ou VRP, éditeur, bouton
Corriger du diagnostic). Trois indices de plus en plus précis sont disponibles ; « Pourquoi ? » explique la notion
une fois la mission réussie. Les missions réussies restent cochées dans le navigateur.

## 6. Où est le code

| Partie | Fichier | Semaine |
| --- | --- | --- |
| VLAN, ACL, NAT, pare-feu | `src/sim/security.mjs`, `src/sim/devices/firewall.mjs`, `router.mjs`, `network.mjs` | S6 |
| Switch administrable | `src/sim/devices/switch.mjs` | S6 |
| Pare-feu en 3D, câbles coupés | `tools/make-models.mjs`, `src/render/shapes.mjs`, `src/render/linkLoad.mjs` | S6 |
| Consoles et missions (logique) | `src/sim/cli.mjs`, `src/sim/config.mjs`, `src/sim/missions.mjs` | S7 |
| Fenêtre de console, onglet Missions, catalogue | `src/ui/terminal.mjs`, `src/ui/missions.mjs`, `src/ui/editorPanel.mjs` | S7 |
| Salle 3D, première personne, étagères | `src/render/lab.mjs`, `src/ui/labHud.mjs` | S7 |
| Plan de la salle (meubles, emplacements U, places), mains, gestes de construction | `src/render/labLayout.mjs`, `src/render/labHands.mjs`, `src/ui/labBuild.mjs` | S7, amélioration du labo |
| Baies, postes de travail, décor, chemins de câbles | `src/render/labFurniture.mjs`, `src/render/cableRoute.mjs`, `src/render/mergeStatic.mjs` | S7, amélioration du rendu |
| Laboratoire en VR, clavier 3D | `src/xr/vrConsole.mjs`, `src/xr/controllers.mjs`, `src/xr/session.mjs` | S7 |

Tests : `tests/lab.test.mjs`, `tests/labLayout.test.mjs`, `tests/cli.test.mjs`, `tests/missions.test.mjs`, et les références
`tests/golden/vlan.txt`, `pare-feu.txt`, `securite-port.txt`.

## 7. Choix de conception

- **La console modifie le scénario, pas l'équipement vivant.** Chaque commande de configuration produit un nouveau
  scénario (validé) que la simulation recharge : la console, l'éditeur, le diagnostic et les missions travaillent
  donc tous sur la même description, et `show running-config` est toujours vrai.
- **Une session de console par équipement**, partagée entre la fenêtre et le pupitre VR : on peut commencer à taper
  à l'écran et finir dans le casque.
- **En VR, c'est la salle qui bouge.** Pour se téléporter, on déplace la salle autour de l'utilisateur au lieu de
  déplacer l'utilisateur : la même méthode marche pour les deux voies VR (WebGPU directe, pont WebGPU), et
  les panneaux restent à portée de main.
- **Le pupitre VR n'apparaît que lorsqu'une console est ouverte** : sinon il masquerait les équipements que l'on vise.
- **Une salle réaliste, mais lisible.** Chaque équipement d'infrastructure est monté dans une baie à hauteur de
  travail (0,8 m), sur une tablette au-dessus de l'onduleur ; autour de lui, obturateurs ventilés, passe-câbles à
  anneaux, panneau de brassage et ventilation, dans des couleurs qui tranchent avec les équipements (gris très clair,
  noir, bleu marine, bleu ardoise) : on distingue d'un coup d'œil la baie de ce qu'elle porte ; les câbles montent dans les chemins de
  câbles au lieu de traverser l'allée. Les équipements restent environ deux fois plus grands que nature pour que leurs
  ports et leurs voyants se lisent à un mètre.
- **Des raccourcis de commandes** sur le pupitre : taper au clavier 3D est lent, les commandes courantes du système
  de l'équipement sont proposées en un geste.
