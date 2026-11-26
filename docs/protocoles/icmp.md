# ICMP — Internet Control Message Protocol

**Rôle.** Messages de contrôle d'IP. La commande `ping` s'en sert pour vérifier qu'une machine est joignable ;
les routeurs et les hôtes s'en servent pour signaler une erreur à l'émetteur d'un paquet.

| | |
| --- | --- |
| Code | `src/sim/protocols/icmp.js` |
| Tests | `tests/icmp.test.js` |
| Scénarios | `scenarios/ping.json`, `scenarios/routage.json` |
| Couche | réseau — dépend d'ARP |
| Action de scénario | `{ "action": "ping", "from": "pc1", "to": "pc2", "count": 1, "ttl": 64 }` |

## Messages simulés

| Type | Code | Nom | Émis quand |
| --- | --- | --- | --- |
| 8 | 0 | Echo Request | un ping part (`icmp.echoRequest`) |
| 0 | 0 | Echo Reply | la cible répond, même identifiant et même numéro de séquence (`icmp.echoReply`) |
| 3 | 0 | Destination Unreachable (network) | un routeur n'a aucune route (`icmp.error.net`) |
| 3 | 3 | Destination Unreachable (port) | aucun service UDP n'écoute sur le port visé (`icmp.error.port`) |
| 11 | 0 | Time Exceeded | le TTL arrive à 0 dans un routeur (`icmp.error.ttl`) |

À la réception de l'Echo Reply, l'explication `icmp.success` donne le numéro de séquence, le TTL reçu et
l'aller-retour en temps simulé. Le TTL reçu permet de compter les routeurs traversés (64 au départ, −1 par routeur).

## Ping lancé à la main

Dans l'interface : sélectionner un premier hôte, puis un second, puis « Lancer un ping ». La simulation repart
d'un réseau remis à zéro (caches ARP et tables MAC vides) et ne joue que ce ping (`sim.runAction()`).

## Simplifications pédagogiques

- pas de somme de contrôle ;
- pas de délai d'expiration du ping (une demande sans réponse reste sans suite) ;
- trois messages d'erreur seulement ;
- règle réelle conservée : on ne répond jamais par une erreur ICMP à une erreur ICMP.
