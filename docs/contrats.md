# Contrats communs

Ces contrats ont été fixés en S1 pour que chacun puisse ensuite travailler seul. Ils vivent dans le
code ; ce document les résume. **Les modifier demande une pull request approuvée par les quatre.**

| Contrat | Fichier | Qui s'en sert |
| --- | --- | --- |
| Sujets du bus et forme d'un paquet | `src/sim/events.js` | tous |
| Contrat d'un protocole | `src/sim/events.js` (`PROTOCOL_CONTRACT`) | auteurs de protocoles |
| Format des scénarios | `src/sim/scenario.js`, [format-scenario.md](format-scenario.md) | auteurs de scénarios |
| Commandes | `src/sim/commands.js` | interface, panneau VR |
| API de rendu | `src/render/api.js`, [api-rendu.md](api-rendu.md) | interface, VR, animation |
| Zones de la page | `index.html`, [conception/maquette.md](conception/maquette.md) | interface, VR |

## 1. La simulation vue de l'extérieur

```js
import { createSimulation, Topics } from './simulation.js';

const sim = createSimulation();
await sim.loadScenarioFromUrl('scenarios/ping.json');
const off = sim.on(Topics.PACKET_SEND, (event) => { /* … */ });  // s'abonner
sim.execute('play');     // 'play' | 'pause' | 'step' | 'speed' (valeur) | 'reset'
sim.can('pause');        // la commande est-elle disponible ?
sim.tick(dtMs);          // à chaque image : temps réel écoulé
sim.state; sim.now; sim.speed; sim.scenario;
sim.device('pc1');       // équipement simulé (adresses, tables)
sim.text('arp.request'); // texte { fr, en } d'une explication
```

## 2. Sujets publiés sur le bus

| Sujet (`Topics.…`) | Charge utile | Publié quand |
| --- | --- | --- |
| `SCENARIO_LOADED` | `{ scenario }` | un scénario vient d'être chargé |
| `RESET` | `{}` | retour au début |
| `STATE` | `{ state, previous }` | `ready`, `playing`, `paused`, `finished` |
| `SPEED` | `{ speed }` | changement de vitesse |
| `CLOCK` | `{ now }` | l'horloge simulée a avancé (ms) |
| `STEP` | `{ index, step }` | une étape du scénario démarre |
| `PACKET_SEND` | `{ tx, packet, from, to, linkId, time, duration, notes }` | un paquet quitte un équipement |
| `PACKET_RECEIVE` | `{ tx, packet, device, from, linkId, time, accepted, notes }` | il arrive au bout du câble |
| `PACKET_DROP` | `{ packet, device, time, notes }` | un équipement le détruit |
| `DEVICE_UPDATE` | `{ device, what, time }` | une table ou une adresse a changé |
| `NOTE` | `{ device, time, notes }` | explication sans paquet |
| `FINISHED` | `{ now }` | plus rien à jouer |
| `SELECT` | `{ kind, id?, packet? }` | publié par l'interface : sélection d'un équipement ou d'un paquet |

`tx` identifie **un trajet sur un câble** (un même paquet diffusé sur trois câbles = trois `tx`).
`notes` est une liste de `{ key, params }` ; le texte se lit avec `sim.text(key)`.

## 3. Forme d'un paquet

```js
{
  id: 'p12', flow: 'p9',          // flow : message d'origine, conservé de saut en saut
  protocol: 'icmp',               // l'une des 9 familles : arp icmp ip udp tcp dns dhcp http ipv6
  label: 'ICMP Echo Request',
  cast: 'unicast',                // 'unicast' | 'broadcast' | 'multicast' (déduit de eth.dst)
  eth: { src, dst, type },        // obligatoire
  ip:  { src, dst, ttl, proto },  // si le paquet est un paquet IP
  icmp | udp | tcp | dns | dhcp | http | arp | ipv6: { … },
  data: 'contenu simplifié',
  explain: { key, params },       // explication posée par l'émetteur
}
```

## 4. Contrat d'un protocole (patron Strategy)

Un protocole est un fichier `src/sim/protocols/<id>.js` dont l'export par défaut est :

| Membre | Rôle |
| --- | --- |
| `id`, `name`, `layer` | identifiant (= nom du fichier), nom affiché, couche (`liaison`, `réseau`, `transport`, `application`) |
| `requires` | protocoles dont il dépend |
| `actions` | actions de scénario qu'il sait lancer |
| `texts` | explications : `{ 'arp.request': { fr, en } }` |
| `install(device, net)` | branche ses réceptions sur chaque équipement : `device.on('eth:ARP', fn)` |
| `start(net, step)` | lance une action (obligatoire si `actions` n'est pas vide) |
| `describe(packet)` | lignes pour l'inspecteur : `[{ label: {fr, en}, value }]` |
| `table(device)` | facultatif : tableau d'état pour le panneau d'infos |

`validateProtocol()` vérifie ce contrat au chargement : un protocole incomplet est refusé avec un message clair.

## 5. Commandes (patron Command)

| Commande | Disponible dans l'état | Effet |
| --- | --- | --- |
| `play` | prêt, pause | le temps simulé avance |
| `pause` | lecture | le temps se fige, les paquets restent en place |
| `step` | prêt, pause | avance jusqu'à la prochaine arrivée de paquet, puis pause |
| `speed` | tous | facteur 0.5, 1, 2 ou 4 |
| `reset` | tous | retour au début, tables des équipements vidées |

## 6. Mocks

- `src/sim/mockEngine.js` — `createMockSimulation()` : même interface que la vraie simulation,
  rejoue une liste d'évènements écrite à la main. Pour développer l'interface ou le rendu sans le moteur.
- `src/render/mockRender.js` — `createMockRender()` : même API que le rendu, sans carte graphique. Pour tester
  l'interface ; sert aussi de repli si ni WebGPU ni WebGL 2 ne sont disponibles.
