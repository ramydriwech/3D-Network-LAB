# Le rendu 3D

Le rendu (`src/render/`) dessine la topologie et les paquets avec Three.js r187. Il ne contient aucune logique
réseau : il affiche ce que la simulation publie sur le bus. Son interface publique est décrite dans [api-rendu.md](api-rendu.md).

## Modules

| Fichier | Rôle |
| --- | --- |
| `index.mjs` | `initRender()` : assemble la scène, affiche une topologie, fournit l'API de rendu |
| `scene.mjs` | moteur `WebGPURenderer` (100 % WebGPU, sans secours WebGL), caméra, éclairage et ombres, niveaux de qualité, grille, navigation (OrbitControls), cadrage |
| `webgpu.mjs` | vérification que WebGPU est utilisable avant de créer le moteur (`requireWebGPU`, `WebGPUUnavailableError`) : données pures, testées |
| `environment.mjs` | panorama lumineux HDR calculé (ambiances « studio » et « lab ») : données pures, testées |
| `quality.mjs` | niveaux de qualité Auto / Basse / Haute : données pures, testées |
| `contactShadow.mjs` | ombres de contact peintes sous les objets ; marquage des objets qui portent des ombres |
| `factory.mjs` | fabrique : modèle réaliste de chaque équipement, sinon modèle GLB, sinon forme simple (patron Factory) |
| `deviceLayout.mjs` | disposition de chaque modèle du catalogue (forme, dimensions, ports, voyants) et règle des voyants : données pures, testées |
| `deviceModels.mjs` | construction 3D des équipements réalistes d'après leur disposition |
| `portLeds.mjs` | voyants des ports allumés pendant la simulation (lien, activité, port bloqué) |
| `shapes.mjs` | formes simples (cube, cylindre) : S1, puis repli si un modèle manque |
| `links.mjs` | câbles : cordons souples branchés dans les prises, avec leurs connecteurs (fiche RJ45 transparente, LC duplex pour la fibre) |
| `cableRoute.mjs` | tracé des câbles (de prise à prise, par le sol) et couleur de gaine par type de câble : données pures, testées |
| `linkLoad.mjs` | câbles vivants : lueur de passage (couleur du protocole), étiquettes de charge et de vitesse, câble coupé, clignotement du diagnostic |
| `lab.mjs` | salle du laboratoire : construite d'après son plan (meubles, équipements installés), deux étagères (Équipements, Mobilier), vue à la première personne, survol, VR à l'échelle réelle ; visée des prises et des emplacements, silhouette de ce que l'on pose |
| `labLayout.mjs` | plan de la salle : catalogue du mobilier, emplacements U des baies et places des bureaux et tables, collisions au sol, position de chaque équipement installé, plan automatique des scénarios : données pures, testées |
| `labHands.mjs` | les mains de Steve (vue à la première personne) : mains humaines (paume, doigts de trois phalanges, pouce, ongles, poignet, manche de blouse) ; marche, gestes ; équipement saisi par ses côtés, qui glisse de l'étagère aux mains puis des mains à sa place (`dropTo`) ; meuble poussé ; câble en main continu : rouleau de quatre spires → fiche, et prise → rouleau une fois le premier bout branché |
| `labFurniture.mjs` | mobilier et décor de la salle : baies à emplacements U (`rackCabinet` : une plaque d'obturation sur chaque U libre ; obturateurs, passe-câbles, panneau de brassage, ventilation, aux couleurs distinctes des équipements), postes de travail, rouleaux de câbles de l'étagère « Équipements », faux plancher, murs, fenêtre, tableau, chemins de câbles… |
| `mergeStatic.mjs` | fusion des pièces fixes en un maillage par matériau (équipements, salle) : moins d'appels de dessin |
| `labels.mjs` | étiquettes : texte dessiné dans un canevas 2D, affiché sur un sprite |
| `packetStyles.mjs` | couleur par protocole, forme par type de diffusion (données pures, testées) |
| `packetAnimator.mjs` | déplacement des paquets sur les câbles (Ayoub) |
| `api.mjs`, `mockRender.mjs` | liste de l'API et fausse version sans carte graphique |

## Le moteur : 100 % WebGPU

`scene.mjs` vérifie d'abord que WebGPU est utilisable (`requireWebGPU()`, `webgpu.mjs`), crée un `THREE.WebGPURenderer`
et attend son initialisation (`await renderer.init()`), d'où le `await initRender()` de `main.mjs`.

| Situation | Résultat | Dans la scène |
| --- | --- | --- |
| navigateur avec WebGPU et carte acceptée | **WebGPU**, à l'écran comme en VR | pastille « WebGPU » (verte) |
| navigateur sans WebGPU, WebGPU désactivé, carte refusée, ou échec au démarrage | pas de scène 3D : **aucun secours WebGL** | message qui explique la cause et les navigateurs qui conviennent ; le reste de l'application fonctionne |

Si Three.js passe malgré tout sur son moteur WebGL interne, `createScene()` le refuse (`renderer.backend.isWebGPUBackend`).
Les raisons de ce choix sont dans [choix-moteur-rendu.md](choix-moteur-rendu.md).

## La scène

- **Repère** : le sol est le plan y = 0 ; les positions viennent du scénario (`"position": [x, y, z]`).
- **Groupe `world`** : toute la topologie (grille, câbles, équipements, paquets) vit dans un seul groupe.
  En VR, il suffit de réduire et de déplacer ce groupe pour poser le réseau devant l'utilisateur.
- **Cadrage** : à l'affichage d'une topologie, la caméra se place pour la voir en entier, en reculant davantage sur un écran étroit ou en portrait.
- **Navigation** : glisser = tourner, molette ou pincement = zoomer, clic droit ou deux doigts = déplacer. La caméra ne passe pas sous le sol.
- **Socle** (vue classique) : un sol sombre et satiné, plus clair au centre, qui se fond dans le fond sans bord
  visible ; une grille discrète pour lire les distances ; un léger brouillard de profondeur (au-delà de 45 unités).
  Grille, socle et ombres portées se masquent ensemble dans le laboratoire et en VR.

## Mode classique et laboratoire

L'application s'ouvre **dans le laboratoire** (`lab.enter()` dès le premier scénario chargé, `src/ui/labHud.mjs`) ;
le **mode classique** — la topologie seule sur son socle, vue d'ensemble de qui est relié à qui — s'ouvre à la
demande : bouton « Mode classique / Retour au labo » ou touche **L**, ou `?classique` dans l'adresse.

Les deux vues montrent les **mêmes objets** (le groupe `world`) : le laboratoire réduit ce groupe et le pose dans la
salle. Pour que le mode classique soit lisible de loin, une **échelle d'affichage** (`setViewScale`, `viewScale`)
grossit les objets sans changer les distances de la topologie :

| Objet | Mode classique (`CLASSIC_SCALE` = 1,5) | Laboratoire |
| --- | --- | --- |
| équipements (avec leur étiquette, anneau de sélection, ombre, voyants) | × 1,5 | × 1 |
| câbles : épaisseur, connecteurs, départ du cordon (`routing.scale`, `links.mjs`) | × 1,5 | × 1 |
| lueur de passage, étiquettes de câble, de charge et de port | × 1,5 | × 1 |
| paquets : point, halo, tige, carte-message (`packetAnimator.mjs`) | × 2,25 (1,5 × `CLASSIC_PACKET_BOOST`) | × 1 |

Les paquets grossissent un peu plus pour que la carte (« ARP Reply / PC2 → PC1 ») se lise depuis la vue d'ensemble.
Le laboratoire repasse à 1 en entrant (avant de construire la salle : PC à leur taille sur les bureaux, fiches dans
les prises) et remet 1,5 en sortant, puis recadre la caméra sur toute la topologie (`frameTopology`).

## Éclairage, ombres et qualité

L'éclairage suit les règles physiques de Three.js : les lumières ont des intensités réelles et l'image est ramenée à
l'écran par un **réglage de tonalité « neutre »** (`NeutralToneMapping`), choisi parce qu'il respecte les teintes,
donc les couleurs des protocoles. Les éléments d'interface dessinés dans la scène (étiquettes, tableau blanc, voyants,
anneaux de sélection) en sont exclus (`toneMapped: false`) : leurs couleurs restent exactes.

| Source | Rôle | Où |
| --- | --- | --- |
| **environnement** | lumière indirecte et reflets : c'est lui qui rend le métal et le plastique crédibles | `environment.mjs` → `scene.environment` |
| lumière du ciel (hémisphère) | léger complément | `scene.mjs` |
| « soleil » (lumière directionnelle) | lumière principale, la seule qui **porte des ombres** | `scene.mjs` |
| ombres de contact | tache floue sous chaque équipement et chaque meuble : elle « pose » l'objet | `contactShadow.mjs` |

L'**environnement** est un panorama équirectangulaire **calculé** (aucun fichier à télécharger), en lumière linéaire
HDR : une dalle LED vaut plusieurs fois un mur. Deux ambiances : `studio` pour la vue classique (deux boîtes à
lumière et un liseré à l'horizon) et `lab` pour la salle (plafond à dalles, murs gris clair avec leur bandeau bleu).
Le laboratoire passe de l'une à l'autre en entrant et en sortant (`setAmbience`).

**Ombres portées figées.** La carte d'ombre n'est pas recalculée à chaque image : `index.mjs` calcule à chaque image
une empreinte de la scène (position du groupe `world`, des équipements, de la salle) et ne recadre la lumière que
si elle change : topologie, glisser-déposer, entrée dans le labo, VR, téléportation. Par sécurité, la carte est aussi
recalculée toutes les 500 ms, car WebGPU prépare ses programmes de dessin en arrière-plan, parfois pendant plusieurs
secondes, et un objet tout neuf pourrait manquer à la première carte. Les paquets ne portent pas d'ombre.

| Niveau | Contenu | Choisi par « Auto » |
| --- | --- | --- |
| **Basse** | environnement, ombres de contact, densité de pixels ≤ 1,5 | écran tactile (téléphone, tablette, casque autonome) |
| **Haute** | en plus : ombres portées (carte 2048 × 2048, bords adoucis), densité de pixels ≤ 2 | souris (ordinateur) |

Le réglage se choisit dans la liste **Qualité** de la barre de commandes ; il est mémorisé dans le navigateur.
`?quality=low` ou `?quality=high` dans l'adresse l'impose, pour une démonstration ou une capture.

## Modèles 3D

Chaque équipement est **construit dans le code** d'après sa fiche du catalogue (`src/sim/catalog.mjs`) : deux modèles
d'un même type ne se ressemblent donc pas (un switch 8 ports de bureau n'est pas un switch 24 ports de baie). Aucun
fichier à télécharger, aucune licence tierce. `deviceLayout.mjs` calcule la disposition (données pures, testées) ;
`deviceModels.mjs` en fait la 3D.

| Forme | Modèles | Détails |
| --- | --- | --- |
| baie 1U | switchs 24 ports, routeurs, pare-feu SG-8X | boîtier métallique aux arêtes arrondies, oreilles de fixation et leurs vis, prises RJ45 (deux rangées au-delà de 8 ports : impairs en haut, pairs en bas, comme sur un vrai switch), cages SFP pour les ports 10 Gb/s, prise console bleue des équipements administrables, grille d'aération |
| bureau | switchs 8 ports, pare-feu SG-3 | petit boîtier sur patins en caoutchouc |
| baie 2U | serveurs | baies de disques avec leurs témoins, panneau de contrôle, prises réseau à l'arrière (leurs voyants sont reportés en façade : « LAN 1 », « LAN 2 ») |
| poste de travail | PC | écran allumé (fenêtre d'invite de commandes), unité centrale avec témoin « LAN », clavier, souris |

Les **façades sont imprimées** dans un canevas : marque fictive (NETCORE, VERSA, SHIELD, d'après le système), nom
du modèle, numéros des ports, repères PWR / SYS. Le couvercle a ses fentes d'aération et une **bande de la couleur
du type** à l'avant (vert switch, orange routeur, rouge pare-feu, violet serveur), pour reconnaître un équipement
de loin. Les anciens modèles (poste NX-0, switch CX-8F) sont en plastique beige. Sur un pare-feu, une étiquette
colorée sous chaque prise indique sa zone (vert inside, rouge outside, orange dmz).

L'objet 3D d'un équipement (`render.deviceObject(id)`) porte dans `userData` sa disposition (`layout`),
le point de branchement de chaque port (`ports`) et ses voyants (`leds`).

**Voyants des ports** (`portLeds.mjs`, règle `portLedState` dans `deviceLayout.mjs`) : chaque prise a deux voyants,
comme sur un vrai switch.

| Voyant | État | Signification |
| --- | --- | --- |
| lien | éteint | pas de câble, ou port éteint (`shutdown`) |
| lien | vert | câble branché, lien négocié à 1 Gb/s ou plus |
| lien | orange | lien à moins de 1 Gb/s : une carte ou le câble le bride (scénario « Débit ») |
| lien | orange clignotant | port bloqué (`err-disabled`) par la sécurité de port |
| activité | vert clignotant | une trame part ou arrive sur ce port |

L'activité suit l'horloge simulée : en pause, les voyants se figent ; en pas à pas, on voit quel port s'allume.
Lors d'une diffusion ARP, on voit le switch inonder ses ports.

**Modèles de secours.** Si un modèle ne peut pas être construit, la fabrique prend le modèle GLB simplifié de
`assets/models/` (`pc.glb`, `server.glb`, `switch.glb`, `router.glb`, `firewall.glb`, générés par
`tools/make-models.mjs`), puis à défaut la forme simple de `shapes.mjs`.

## Câbles

Un câble est un **cordon souple branché dans la prise** de chaque équipement (point de branchement fourni par le
modèle 3D, voir « Modèles 3D »). Son tracé (`cableRoute.mjs`) sort perpendiculairement à la façade, descend au
sol, le longe, puis remonte jusqu'à la prise d'en face ; le tube suit une courbe lisse passant par ces points, avec
un connecteur à chaque bout (un port sans emplacement connu, modèle de secours, part du bord de l'équipement).

Les connecteurs (`cablePlug`, `links.mjs`) sont ceux d'un vrai câble, à l'échelle des prises des modèles :

- **cuivre (Cat 5 à Cat 6a) : fiche RJ45** — corps transparent qui dépasse de la prise, on y voit les huit fils
  colorés (ordre T568B), les huit contacts dorés à la pointe et la barre de sertissage ; languette de verrouillage
  sur le dessus ; manchon à la couleur de la gaine ;
- **fibre OM3 : connecteur LC duplex** — deux petits boîtiers carrés côte à côte (émission et réception), chacun
  avec sa languette et son embout céramique blanc, réunis par une agrafe ; deux manchons qui se rejoignent dans le
  câble.

Le cordon part du manchon (`PLUG_REACH`), pas du fond de la prise : il ne masque pas l'intérieur de la fiche. Les
rouleaux de l'étagère « Équipements » du labo portent les mêmes connecteurs, en plus petit. Chaque connecteur ne coûte que
trois maillages (corps, intérieur en couleurs par sommet, manchon), aux géométries partagées par tous les câbles.

| Type de câble (catalogue) | Couleur de gaine |
| --- | --- |
| Cat 5 | gris |
| Cat 5e | blanc cassé |
| Cat 6 (par défaut) | bleu |
| Cat 6a | violet |
| fibre OM3 | turquoise (couleur normalisée de la fibre OM3) |

Les câbles sont fins (rayon de 1,8 cm à l'échelle de la scène) : le point lumineux d'un paquet, plus gros, se voit
toujours. Leur courbe lisse est calculée dans `cableRoute.mjs` (`smoothRoute`, testée) et bornée par le plus bas de
ses points de passage : un câble ne passe jamais sous le sol ni sous un chemin de câbles.

`linkLoad.mjs` fait vivre les câbles :

- **passage d'un paquet** : pendant qu'il traverse le câble, une lueur légère de la **couleur de son protocole** court
  le long du câble, dans son sens, au rythme de l'horloge simulée (figée en pause). Transparente (40 %) et plus fine que
  le point lumineux, elle ne le masque jamais ; elle s'éteint quand le paquet est arrivé ;
- **type et vitesse** : chaque câble porte une étiquette « Cat 6 · 1 Gb/s » (`cableTagLines`, `cableRoute.mjs`, testée) :
  la vitesse RÉELLE du lien, négociée (la plus petite des deux cartes et du câble), et non la capacité du câble. Quand
  une carte ou le câble bride le lien, elle est orange avec « bridé par … » et reste toujours visible. Les autres,
  grises et discrètes, n'apparaissent que sur les câbles proches de la caméra, sur ceux de l'équipement sélectionné,
  et partout dans l'onglet Construire (`render.linkLoad.setShowAll`, appelé par l'éditeur) ;
- **charge du lien** (demande du superviseur) : au-delà de 50 % d'utilisation, une étiquette « Charge 72 % » apparaît au
  milieu du câble, orange, puis rouge au-delà de 80 % ; au-dessous, rien ne s'affiche ;
- **câble coupé** (`shutdown`, `err-disabled`) : gaine rouge sombre ; le diagnostic fait clignoter la lueur en magenta.

**Dans le laboratoire, les câbles passent par les chemins de câbles** (`render.setCableRouting({ mode: 'tray', height })`,
appelé par `lab.mjs` en entrant ; `{ mode: 'floor' }` en sortant). Au lieu de traverser l'allée, un cordon longe la
façade de sa baie jusqu'au bord le plus proche de sa destination, monte le long du montant, suit à angle droit les
chemins de câbles suspendus sous le plafond, puis redescend jusqu'à l'autre prise (`trayRoute`). Chaque câble est
un peu décalé dans le chemin : ils forment une nappe. La salle dessine les chemins là où passent les câbles
(`render.cableTrays()`, tronçons fusionnés par `trayLines`). Les paquets suivent les câbles : on les voit monter,
longer les chemins et redescendre.

Dans l'éditeur, glisser un équipement retrace ses câbles en direct (`render.updateLinks(id)`) : ils restent
branchés dans leurs prises, et les étiquettes de ports suivent.

## Paquets

Un paquet est une **carte-message** : tout ce qu'il faut savoir y est écrit, sans connaître les couleurs (un
étudiant ne sait pas que l'ambre est ARP).

```
   ┌──────────────────────┐
   │ ICMP Echo Reply      │   type de message
   │ PC3 → PC1            │   qui parle à qui
   └──────────┬───────────┘
              │
   ═══════════●═══════════    point lumineux sur le câble
```

- 1re ligne (en gras) : le **type de message**, c'est-à-dire le libellé que lui donne son protocole ;
- 2e ligne : **qui parle à qui** (`packetCaption`, `packetStyles.mjs`, données pures, testées) : adresses IP de bout en
  bout (« PC1 → PC3 » sur chaque câble traversé), sinon adresses MAC ; « tous » pour une diffusion, « groupe » pour une
  multidiffusion ;
- le **point lumineux** (et son halo) glisse sur le câble et montre la position exacte du paquet ; une **tige** le relie à
  la carte ;
- le liseré, le point et la traînée ont la **couleur du protocole**, un simple repère en plus, expliqué par la légende
  vivante de l'interface (`src/ui/packetLegend.mjs`), qui n'affiche que les protocoles du scénario.

| Protocole | Couleur | | Protocole | Couleur |
| --- | --- | --- | --- | --- |
| ARP | ambre `#f59e0b` | | DNS | violet `#a855f7` |
| ICMP | vert `#22c55e` | | DHCP | rose `#ec4899` |
| IP (test) | gris `#94a3b8` | | HTTP | rouge `#ef4444` |
| UDP | cyan `#06b6d4` | | IPv6 | turquoise `#14b8a6` |
| TCP | bleu `#3b82f6` | | | |

La couleur seule ne porte jamais l'information : tout est écrit sur la carte.

**Animation.** La position d'un paquet est calculée à partir de l'horloge simulée :
`progression = (sim.now − départ) / durée`. En pause les paquets se figent ; à vitesse ×4 ils vont quatre fois plus
vite. Un paquet arrivé reste visible devant son destinataire jusqu'au départ des suivants : après un pas à pas, on peut cliquer dessus pour l'inspecter.

Le point **suit la courbe de son câble** (`render.linkPath(linkId)`), posé sur la gaine, d'une prise à l'autre ; la
traînée s'oriente dans le sens du câble. Sans câble connu, il retombe sur un trajet en arc entre les deux équipements.
La carte est cliquable : une zone invisible à sa taille, tournée vers la caméra, porte la sélection (une étiquette ne se
vise pas directement : les visées de la VR et du laboratoire n'ont pas de caméra pour les sprites).

| Effet | Rôle | Qualité |
| --- | --- | --- |
| carte-message : type de message, « qui → qui » | présenter le paquet sans connaître les couleurs | toutes |
| point lumineux et tige | position exacte sur le câble | toutes |
| traînée de la couleur du protocole | montrer le sens et la vitesse | haute |
| carte courte (type de message seul) au loin quand plus de 4 paquets circulent | éviter l'encombrement | toutes |
| trame perdue : carte rouge « ✕ perdu », qui tombe et s'efface | perte (scénario « Débit ») | toutes |

## Performances (mobile)

| Mesure | Où |
| --- | --- |
| géométries et matériaux créés une fois et partagés | `shapes.mjs`, `links.mjs`, `packetAnimator.mjs` |
| modèles construits dans le code : géométries, matériaux et textures de façade partagés entre équipements | `deviceModels.mjs` |
| tous les voyants d'un équipement en une seule `InstancedMesh` (un appel de dessin), prises de même `InstancedMesh` | `deviceModels.mjs` |
| voyants recolorés au plus toutes les 40 ms, seulement s'ils changent | `portLeds.mjs` |
| pièces fixes fusionnées en un maillage par matériau : un équipement passe d'une vingtaine de pièces à quelques-unes, la salle de plusieurs milliers à environ deux cents ; matériaux de baie partagés pour que les baies se fusionnent entre elles | `mergeStatic.mjs`, `labFurniture.mjs` |
| paquets : un point, une tige et deux étiquettes par paquet ; géométries et matériaux partagés ; traînée seulement en qualité haute | `packetAnimator.mjs` |
| câbles retracés seulement quand un équipement bouge ; lueur = un tube par câble ; charge recalculée toutes les 150 ms | `links.mjs`, `linkLoad.mjs` |
| densité de pixels plafonnée (1,5 en qualité basse, 2 en haute) | `scene.mjs`, `quality.mjs` |
| ombres portées seulement en qualité haute, carte recalculée quand la scène bouge (et toutes les 500 ms) | `scene.mjs`, `index.mjs` |
| ombres de contact : un plan et une texture partagés | `contactShadow.mjs` |
| nombre de paquets affichés plafonné (16 sur écran tactile, 48 ailleurs) | `index.mjs` (`maxPackets`) |
| étiquettes = une texture par étiquette, redessinée seulement si le texte change | `labels.mjs` |
| horloge de l'image bornée à 100 ms (onglet revenu d'arrière-plan) | `index.mjs` |

## Lisibilité en VR

`setVRMode(true)` réduit la topologie à 1,8 m de large et la pose à 0,85 m de haut, 1,5 m devant l'utilisateur, comme
une maquette sur une table. La grille est masquée et les étiquettes sont agrandies (× 1,7) pour rester lisibles à un mètre.
À la sortie, tout est remis comme avant.

## Protocoles documentés par Aziz

[ICMP](protocoles/icmp.md) · [UDP](protocoles/udp.md) · [DNS](protocoles/dns.md)
