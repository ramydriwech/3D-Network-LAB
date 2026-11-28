# Manuel utilisateur

3D-Network-LAB montre, dans une scène 3D, comment les protocoles réseau échangent leurs messages. Vous
choisissez un scénario, vous lancez la lecture, et chaque message est animé et expliqué.

## 1. Ouvrir l'application

Ouvrez l'adresse du site dans **Chrome** (PC ou smartphone) : `https://<compte>.github.io/<depot>/`.
Rien à installer, aucun compte à créer.

L'application s'ouvre **dans le laboratoire** (voir la partie 13) : une salle où le réseau du scénario est monté
dans des baies et sur des postes de travail. Le bouton **Mode classique** (en haut à droite de la scène, à côté de **Survol** ; ou la touche **L**)
affiche à la place une **vue d'ensemble** de la topologie, pour voir d'un coup d'œil qui est relié à qui ; les
équipements, les câbles et les paquets y sont dessinés plus grands. **Retour au labo** (ou **L**) ramène dans la
salle. Pour ouvrir directement le mode classique, ajoutez `?classique` à l'adresse.

L'écran comporte trois parties :

| Partie | Contenu |
| --- | --- |
| **Barre du haut** | choix du scénario, bouton d'installation, bouton VR, langue (Français / English) |
| **Scène 3D** et, dessous, les **commandes** | le réseau, les paquets ; Lecture, Pause, Pas à pas, Vitesse, Réinitialiser |
| **Panneaux** (à droite sur PC, dessous sur téléphone) | explications, équipement sélectionné, inspecteur de paquet, journal |

## 2. Se déplacer dans la scène

En mode classique (et en mode **Survol** du laboratoire) :

| Action | Souris | Écran tactile |
| --- | --- | --- |
| Tourner autour du réseau | glisser (bouton gauche) | glisser avec un doigt |
| Zoomer | molette | pincer avec deux doigts |
| Déplacer la vue | glisser (bouton droit) | glisser avec deux doigts |
| Sélectionner | clic | toucher |

Les équipements : **PC** (écran bleu), **serveur** (tour violette), **switch** (boîtier vert), **routeur** (boîtier orange).
Au-dessus de chaque équipement : son nom, puis son adresse — l'adresse IP d'un PC, d'un serveur, d'un routeur ou
d'un pare-feu (deux au plus, puis « +n »), l'adresse MAC d'un switch (un switch n'a pas d'adresse IP : il travaille
avec les adresses MAC). Les petites étiquettes près des switches et des routeurs sont les noms de leurs ports.

## 3. Jouer un scénario

1. Choisissez un scénario dans la liste en haut. Le panneau **Explications** en donne le résumé ; dépliez « À observer ».
2. Appuyez sur **Lecture**. Les paquets se déplacent sur les câbles ; à chaque message, « Ce qui se passe » explique qui envoie quoi et pourquoi.
3. **Pause** fige tout : les paquets restent où ils sont.
4. **Pas à pas** avance jusqu'à la prochaine arrivée d'un paquet, puis s'arrête. C'est le meilleur mode pour apprendre : lisez l'explication, puis avancez.
5. **Vitesse** : ×0,5 (ralenti), ×1, ×2, ×4.
6. **Réinitialiser** revient au début ; les équipements oublient tout ce qu'ils avaient appris.

Raccourcis clavier : **Espace** = lecture / pause · **→** = pas à pas · **R** = réinitialiser.

### Lire les paquets

Chaque paquet est une **carte-message** posée au-dessus d'un **point lumineux** qui glisse sur le câble :

```
   ┌──────────────────────┐
   │ ICMP Echo Reply      │   type de message
   │ PC3 → PC1            │   qui parle à qui
   └──────────┬───────────┘
              │
   ═══════════●═══════════    point lumineux sur le câble
```

- La 1re ligne donne le **type de message** : ARP Request, DHCP Discover, TCP SYN, HTTP GET /…
- La 2e ligne dit **qui parle à qui** : « PC1 → PC3 » (de bout en bout, même derrière un routeur), « PC1 → tous »
  pour une diffusion, « PC1 → groupe » pour une multidiffusion.
- Le liseré de la carte et le point ont la couleur du protocole ; la **légende**, en bas à gauche de la scène,
  n'affiche que les protocoles du scénario en cours.
- Quand beaucoup de paquets circulent, les cartes éloignées ne gardent que la 1re ligne ; en s'approchant, la 2e
  réapparaît.
- Une trame **perdue** : sa carte devient rouge (« ✕ perdu »), puis tombe et s'efface.
- Un **clic** sur une carte ouvre l'inspecteur : tous les champs du message (adresses, TTL, ports…).

### Les scénarios

| Scénario | Ce que vous allez voir |
| --- | --- |
| Ping : ARP puis ICMP | ARP trouve une adresse MAC, puis le ping ; d'abord dans un réseau, puis à travers un routeur |
| DHCP | un PC sans adresse obtient sa configuration en quatre messages |
| UDP | un envoi sans connexion ; ce qui arrive quand le port est fermé |
| DNS | un nom traduit en adresse IP ; un nom inexistant ; le cache |
| TCP | ouverture en trois temps, données acquittées, fermeture ; connexion refusée |
| HTTP | DNS, puis TCP, puis la page web ; une page introuvable (404) |
| Routage statique et TTL | deux routeurs, le TTL qui diminue, un paquet détruit, une destination sans route |
| IPv6 | la découverte de voisin qui remplace ARP |
| Topologie de démonstration | un simple paquet de test, pour essayer les commandes |

## 4. Lancer un ping entre deux machines

1. Ouvrez le scénario **Ping**.
2. Cliquez sur un premier PC : un anneau bleu l'entoure. Le panneau **Équipement** affiche ses adresses.
3. Cliquez sur un second PC : anneau vert.
4. Appuyez sur **Lancer un ping PC1 → PC4** dans le panneau Équipement.

Le réseau est remis à zéro et le ping démarre : ARP d'abord, ICMP ensuite. « Revenir au scénario » rétablit les étapes prévues.

## 5. Regarder un équipement

Cliquez sur un équipement pour voir ses adresses et ses tables, qui se remplissent pendant la lecture :

- **PC, serveur** : adresse IP, adresse MAC, passerelle, **cache ARP**, connexions TCP ;
- **switch** : **table MAC** (quelle adresse derrière quel port) ;
- **routeur** : **table de routage** et cache ARP.

## 6. Inspecter un paquet

1. Mettez en **pause** ou avancez **pas à pas** : le paquet arrivé reste affiché.
2. Cliquez sur le paquet (sa carte) dans la scène — dans le laboratoire, visez-le avec le viseur, jusqu'à 12 m —
   **ou** sur sa ligne dans le **Journal**. L'onglet **Lecture** s'ouvre s'il était caché.
3. Le panneau **Inspecteur de paquet** détaille la trame comme un analyseur réseau, en-tête par en-tête :
   - **Ethernet II** : MAC destination et source, type (0x0800 IPv4, 0x0806 ARP, 0x86DD IPv6), bourrage, FCS (CRC-32), taille ;
   - **ARP** (opération, adresses de l'émetteur et de la cible), **IPv4** (version, longueurs, identification,
     indicateurs, TTL, numéro de protocole, somme de contrôle de l'en-tête, adresses) ou **IPv6** ;
   - **ICMP**, **ICMPv6**, **UDP** ou **TCP** : types et codes, ports (avec leur service : 53 DNS, 80 HTTP…),
     numéros de séquence, indicateurs, fenêtre, longueur, somme de contrôle ;
   - le message **DHCP**, **DNS** ou **HTTP**, et les données ;
   - en bas, les **octets de la trame** en hexadécimal.
   Les longueurs et les sommes de contrôle sont calculées sur la trame reconstruite octet par octet, comme sur un vrai
   réseau (`src/sim/wire.mjs`).

À essayer : dans le scénario Routage, inspectez le même ping avant et après un routeur. Les adresses IP n'ont pas
changé, les adresses MAC si, et le TTL a perdu 1.

## 7. Installer l'application (facultatif)

L'installation n'est **pas nécessaire** : tout fonctionne dans le navigateur. Elle ajoute une icône sur l'appareil et ouvre l'application dans sa propre fenêtre.

Cliquez sur le bouton **Installer** de la barre du haut.

- **PC ou Android (Chrome, Edge)** : quand le navigateur le permet, le bouton est mis en avant (bleu) et ouvre
  directement sa fenêtre d'installation. Sinon, il explique le geste : icône d'installation dans la barre d'adresse,
  ou menu ⋮ de Chrome → *Installer…* (menu ⋯ d'Edge → *Applications* → *Installer ce site en tant qu'application*).
- **Mac (Safari)** : le bouton rappelle le geste : menu *Fichier* → *Ajouter au Dock*.
- **iPhone, iPad (Safari)** : bouton *Partager* → *Sur l'écran d'accueil*.
- **Firefox sur ordinateur** : il ne sait pas installer les applications web ; le bouton conseille Chrome, Edge ou
  Safari. L'application reste utilisable dans Firefox.

Si vous refusez, rien ne change : continuez dans le navigateur. Le bouton disparaît quand l'application est installée,
et il n'est pas affiché quand vous l'ouvrez déjà comme application installée.

### Utilisation hors ligne

Après **une première visite avec connexion**, l'application se recharge sans réseau (installée ou non). Une pastille « Hors ligne » le signale.

## 8. Mode VR

Avec un casque compatible WebXR, appuyez sur **Entrer en VR**. Sans casque, sur PC :

1. Installez l'extension Chrome **Immersive Web Emulator**.
2. Rechargez la page, puis appuyez sur **Entrer en VR**.
3. Ouvrez les outils de développement (F12), onglet **WebXR**, pour bouger la tête et les manettes.

Dans le casque, le réseau apparaît comme une maquette posée devant vous. À gauche, un **panneau de contrôle** reprend
les commandes et l'explication en cours. Visez un bouton, un équipement ou un paquet avec le rayon d'une manette, puis
appuyez sur la **gâchette**. Le bouton **Quitter** du panneau termine la session.

Si le bouton indique **VR indisponible**, aucun casque ni émulateur n'a été détecté : l'application reste entièrement utilisable à l'écran. Un clic sur ce bouton ouvre le panneau **Technologies** (voir ci-dessous), qui montre ce qui manque.

L'application dessine **en WebGPU seulement**, à l'écran comme en VR (pastille « WebGPU » en bas à droite de la
scène). À l'entrée en VR, un message indique la voie choisie : « VR WebGPU (directe) » sur un casque dont le navigateur
relie WebXR et WebGPU, « VR WebGPU (pont pour émulateur) » avec l'Immersive Web Emulator. Si un casque affiche qu'il ne
sait pas encore afficher du WebGPU en VR, activez « WebXR WebGPU » dans les réglages expérimentaux de son navigateur.

**Panneau « Technologies ».** Un clic sur la pastille **WebGPU** (en bas à droite de la scène), sur **VR indisponible**,
ou sur **Détails techniques** quand WebGPU manque, ouvre un panneau qui mesure en direct ce que l'appareil fournit :
contexte sécurisé (HTTPS), rendu WebGPU et version de Three.js, carte graphique, qualité de l'image, WebXR, session VR
immersive, liaison WebXR + WebGPU (`XRGPUBinding`), possibilité de VR sur cet appareil, hors-ligne, installation.
Chaque ligne est verte (ça marche), orange (ça marche avec une réserve), rouge (ça ne marchera pas) ou grise (sans
objet), avec un conseil quand ce n'est pas vert. **Copier le rapport** le met dans le presse-papiers, pour le joindre à
un message. Avant une démonstration en VR sur un casque, ouvrez ce panneau dans le navigateur du casque : la ligne
« VR sur cet appareil » dit si la VR marchera.

À droite, un second panneau a trois onglets : **Étape** (l'explication en cours), **Fiche** (la fiche technique et
les débits de l'équipement visé) et **Diagnostic** (les problèmes du réseau, avec un bouton **Corriger**).

## 10. Débit : des liens plus ou moins rapides

Chaque câble a une vitesse : la plus petite de celles des deux cartes réseau et du câble. Son **étiquette** donne son
type et cette vitesse réelle : « Cat 6 · 1 Gb/s ». Quand quelque chose bride le lien, elle est **orange** et dit quoi :
« Cat 5 · 100 Mb/s — bridé par le câble », « bridé par PC2 » ; celles-là sont toujours visibles. Les autres
apparaissent quand on s'approche du câble, quand on sélectionne un équipement (pour ses câbles) et dans l'onglet
**Construire**. Pendant la lecture, une étiquette « **Charge** 72 % » signale un lien très utilisé : orange au-delà de
50 %, rouge au-delà de 80 %.

Ouvrez le scénario **Débit** : un même fichier envoyé depuis un poste Gigabit puis depuis un ancien poste à
100 Mb/s, des segments perdus puis renvoyés, et trois envois simultanés qui se partagent le lien du serveur. Le
journal affiche à la fin de chaque transfert sa durée et son débit utile. La vitesse **×0,25** aide à suivre les
retransmissions.

Cliquez un équipement : sous ses adresses, la **fiche technique** donne son modèle, ses caractéristiques (calculées
à partir de ses ports) et, pendant la lecture, les **ports en direct** : vitesse, débits émis et reçus, file
d'attente et trames perdues.

## 11. Diagnostic : trouver ce qui ne va pas

L'onglet **Diagnostic** (en haut de la colonne de droite) vérifie le réseau affiché : adresses en double, passerelle
mal réglée, route manquante, boucle de câbles, câble trop lent… Chaque constat explique **pourquoi** c'est un
problème et **que faire**. **Montrer** surligne les équipements et câbles concernés ; **Corriger** applique la
correction proposée ; **Tout corriger** les enchaîne. **Revenir au scénario d'origine** annule tout.

Essayez le scénario **Diagnostic** : jouez-le (les pings échouent), corrigez, rejouez.

## 12. Construire son propre réseau

L'onglet **Construire** ouvre l'éditeur (détails : `docs/editeur.md`) :

1. **Nouveau réseau vide** (ou **Modifier le scénario affiché**) ;
2. ajoutez des PC, serveurs, switchs et routeurs (choisissez le modèle au-dessus du bouton **+**) ;
3. glissez-les dans la scène ; reliez-les avec l'outil **Relier** (cliquez deux équipements) ;
4. cliquez un équipement pour le régler, ou utilisez **Adressage automatique** ;
5. choisissez un échange (ping, transfert TCP, page web…) et **Lancer**.

**Annuler** / **Rétablir** corrigent une erreur. Le réseau est enregistré automatiquement dans le navigateur ;
**Enregistrer sous…** en garde plusieurs, **Exporter** / **Importer** passent par un fichier JSON.

Sous chaque bouton **+**, la fiche du modèle choisi indique ses ports, sa description et son système (style de
commandes IOS, VRP ou invite de commandes) ; un switch non administrable n'a pas de console.

## 13. Le laboratoire et les consoles

L'application s'ouvre dans une salle où les switchs, routeurs, pare-feu et serveurs sont montés dans des baies, et
les PC posés sur des postes de travail. **ZQSD** / **WASD** pour marcher, la **souris** pour regarder (cliquez d'abord
dans la scène), **E** pour ouvrir la **console** de l'équipement visé, **V** pour voir la salle d'en haut, **L** pour
passer en mode classique (et revenir), **Échap** pour libérer la souris.
**Construire à la main** (guide complet : `docs/laboratoire.md`, partie 2 bis). Steve a des mains : un clic sur
l'étagère **Mobilier** prend une baie, un poste de travail ou une table, un clic le pose (**R** : tourner) ; un clic
sur l'étagère **Équipements** prend un modèle, que l'on installe en visant le bon meuble (l'emplacement U libre d'une
baie s'allume en vert) ; un clic sur un rouleau de câble le prend : on vise une prise (« SW1 · Gi0/3 — libre »), on
clique, puis la prise de l'autre équipement. **F** reprend ce que vous visez (ou débranche une prise) et repose ce que
vous avez en main ; **Suppr** le retire. Chaque geste s'annule avec **Annuler** (onglet Construire).

La console (aussi accessible par **Ouvrir la console** dans le panneau Équipement) accepte de vraies commandes :
`enable`, `configure terminal`, `show ip route`, `interface g0/1`, `ip address …`, `switchport access vlan 20`,
`ip access-list extended …`, `ping 10.0.2.10`… **Tab** complète, **?** affiche l'aide, **↑ ↓** reprennent une
commande. Toute la liste : `docs/console.md`.

L'onglet **Missions** propose six exercices guidés (une panne à réparer, un pare-feu à ouvrir, un réseau à
construire de zéro) : les objectifs se cochent tout seuls, avec trois indices et une explication « Pourquoi ? ».

En VR, vous êtes dans le laboratoire à l'échelle réelle : gâchette sur le sol pour vous téléporter, joystick pour
tourner, gâchette sur un équipement pour ouvrir sa console sur un pupitre avec un **clavier 3D**. Détails :
`docs/laboratoire.md`.

## 9. Dépannage

| Problème | Solution |
| --- | --- |
| Pas de scène 3D ; message « … La scène 3D a besoin de WebGPU » | ouvrez l'application dans Chrome ou Edge récents, Safari 26+ ou Firefox 141+ (Windows) ; activez l'accélération matérielle ; mettez à jour le pilote graphique. Le reste de l'application (scénarios, journal, consoles) fonctionne quand même |
| Rien ne bouge | appuyez sur **Lecture** ; si l'état affiche « Terminé », appuyez sur **Réinitialiser** |
| Impossible de cliquer sur un paquet | mettez en pause d'abord ; ou passez par le **Journal** |
| Le bouton « Installer » n'apparaît pas | l'application est déjà installée, ou le navigateur ne le propose pas (voir § 7 pour Safari) |
| « VR indisponible » | cliquez dessus : le panneau « Technologies » montre ce qui manque ; installez Immersive Web Emulator et rechargez ; vérifiez que l'adresse commence par `https://` |
| L'application ne s'ouvre pas hors ligne | il faut l'avoir ouverte une fois avec une connexion |
| L'ancienne version s'affiche encore | rechargez la page une seconde fois |
| L'affichage est lent sur téléphone | fermez les autres onglets ; réduisez la vitesse de lecture |
| Texte trop petit dans la scène | zoomez (molette ou pincement) |
