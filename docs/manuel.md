# Manuel utilisateur

3D Network Topology montre, dans une scène 3D, comment les protocoles réseau échangent leurs messages. Vous
choisissez un scénario, vous lancez la lecture, et chaque message est animé et expliqué.

## 1. Ouvrir l'application

Ouvrez l'adresse du site dans **Chrome** (PC ou smartphone) : `https://<compte>.github.io/<depot>/`.
Rien à installer, aucun compte à créer.

L'écran comporte trois parties :

| Partie | Contenu |
| --- | --- |
| **Barre du haut** | choix du scénario, bouton d'installation, bouton VR, langue (Français / English) |
| **Scène 3D** et, dessous, les **commandes** | le réseau, les paquets ; Lecture, Pause, Pas à pas, Vitesse, Réinitialiser |
| **Panneaux** (à droite sur PC, dessous sur téléphone) | explications, équipement sélectionné, inspecteur de paquet, journal |

## 2. Se déplacer dans la scène

| Action | Souris | Écran tactile |
| --- | --- | --- |
| Tourner autour du réseau | glisser (bouton gauche) | glisser avec un doigt |
| Zoomer | molette | pincer avec deux doigts |
| Déplacer la vue | glisser (bouton droit) | glisser avec deux doigts |
| Sélectionner | clic | toucher |

Les équipements : **PC** (écran bleu), **serveur** (tour violette), **switch** (boîtier vert), **routeur** (boîtier orange).
Les petites étiquettes près des switches et des routeurs sont les noms de leurs ports.

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
2. Cliquez sur le paquet dans la scène, **ou** sur sa ligne dans le **Journal**.
3. Le panneau **Inspecteur de paquet** détaille ses champs, couche par couche : Ethernet (adresses MAC), IP (adresses,
   TTL), puis le protocole transporté (ports, indicateurs TCP, numéros de séquence, contenu).

À essayer : dans le scénario Routage, inspectez le même ping avant et après un routeur. Les adresses IP n'ont pas
changé, les adresses MAC si, et le TTL a perdu 1.

## 7. Installer l'application (facultatif)

L'installation n'est **pas nécessaire** : tout fonctionne dans le navigateur. Elle ajoute une icône sur l'appareil et ouvre l'application dans sa propre fenêtre.

- **PC (Chrome, Edge)** : bouton **Installer l'application** en haut à droite, ou icône d'installation dans la barre d'adresse.
- **Android (Chrome)** : même bouton, ou menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone, iPad (Safari)** : bouton *Partager* → *Sur l'écran d'accueil*.

Si vous refusez, rien ne change : continuez dans le navigateur. Le bouton n'apparaît pas si l'application est déjà installée ou si le navigateur ne propose pas l'installation.

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

Si le bouton indique **VR indisponible**, aucun casque ni émulateur n'a été détecté : l'application reste entièrement utilisable en mode classique.

En bas à droite de la scène, une pastille indique le moteur de rendu utilisé : **WebGPU** quand le navigateur le
propose, **WebGL 2** sinon. La VR fonctionne avec les deux ; à l'entrée, un message indique la voie choisie
(« VR WebGPU (directe) », « VR WebGPU (pont pour émulateur) » ou « VR WebGL 2 »). Si un casque affiche qu'il ne sait
pas encore afficher du WebGPU en VR, rechargez avec `?backend=webgl` à la fin de l'adresse.

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

Le bouton **Laboratoire** (en haut à droite) vous fait entrer dans une salle où les switchs, routeurs, pare-feu et
serveurs sont montés dans des baies, et les PC posés sur des postes de travail. **ZQSD** / **WASD** pour marcher, la **souris** pour regarder (cliquez d'abord dans la scène), **E** pour
ouvrir la **console** de l'équipement visé, **V** pour voir la salle d'en haut, **Échap** pour libérer la souris.
L'étagère **Catalogue** contient un exemplaire de chaque modèle (cliquez-en un pour le poser devant vous) et, en haut,
un rouleau de chaque type de câble : en le visant, sa fiche s'affiche (vitesse, portée, usage) ; un clic le choisit
pour les prochains branchements (outil « Relier », bouton « Câbler » en VR).

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
| La scène reste noire ; message « Ni WebGPU ni WebGL 2 ne sont disponibles » | mettez le navigateur à jour ; activez l'accélération matérielle dans ses paramètres |
| Rien ne bouge | appuyez sur **Lecture** ; si l'état affiche « Terminé », appuyez sur **Réinitialiser** |
| Impossible de cliquer sur un paquet | mettez en pause d'abord ; ou passez par le **Journal** |
| Le bouton « Installer » n'apparaît pas | l'application est déjà installée, ou le navigateur ne le propose pas (voir § 7 pour Safari) |
| « VR indisponible » | installez Immersive Web Emulator et rechargez ; vérifiez que l'adresse commence par `https://` |
| L'application ne s'ouvre pas hors ligne | il faut l'avoir ouverte une fois avec une connexion |
| L'ancienne version s'affiche encore | rechargez la page une seconde fois |
| L'affichage est lent sur téléphone | fermez les autres onglets ; réduisez la vitesse de lecture |
| Texte trop petit dans la scène | zoomez (molette ou pincement) |
