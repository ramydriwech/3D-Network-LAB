# UDP — User Datagram Protocol

**Rôle.** Transport « sans connexion » : l'émetteur envoie son datagramme sans rien établir avant et sans attendre
d'accusé de réception. Le numéro de port désigne l'application destinataire.

| | |
| --- | --- |
| Code | `src/sim/protocols/udp.js` |
| Tests | `tests/udp.test.js` |
| Scénario | `scenarios/udp.json` |
| Couche | transport — dépend d'ARP et d'ICMP |
| Action de scénario | `{ "action": "udp", "from": "pc1", "to": "srv1", "port": 5005, "data": "temperature=21" }` |

## Déroulement du scénario

1. **Port ouvert (5005).** PC1 envoie un datagramme depuis un port éphémère (49152). Le serveur le remet à
   l'application (`udp.delivered`) et **ne renvoie rien** : PC1 ne saura jamais s'il est arrivé.
2. **Port fermé (9999).** Aucune application n'écoute : le serveur détruit le datagramme (`udp.portClosed`) et
   prévient PC1 par un message ICMP « Port Unreachable ». C'est le seul retour possible en UDP, et il vient d'ICMP.

Un serveur déclare ses ports ouverts dans le scénario : `"services": { "udp": { "listen": [5005] } }`.

## Ce que montre l'inspecteur

Port source, port destination, longueur. À comparer avec TCP : pas de numéro de séquence, pas d'indicateur, pas d'accusé.

## Simplifications pédagogiques

- pas de somme de contrôle ;
- les ports éphémères sont attribués dans l'ordre à partir de 49152 (un vrai système les choisit de façon moins prévisible).

## Utilisé par

DNS (port 53) et DHCP (ports 67 et 68) : `udp.send()` (émettre un datagramme) et `udp.bind()` (écouter sur un port) sont les deux fonctions offertes aux protocoles d'application.
