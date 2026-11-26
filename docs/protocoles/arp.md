# ARP — Address Resolution Protocol

**Rôle.** Trouver l'adresse MAC qui correspond à une adresse IP du réseau local. Sans elle, impossible
de fabriquer la trame Ethernet qui transporte le paquet IP.

| | |
| --- | --- |
| Code | `src/sim/protocols/arp.js` |
| Tests | `tests/arp.test.js` |
| Scénario | `scenarios/ping.json` (ARP précède chaque premier échange) |
| Couche | liaison |

## Déroulement simulé

1. L'émetteur consulte son **cache ARP**. Adresse connue : rien ne circule (`arp.cacheHit`).
2. Sinon il **diffuse** une requête (MAC destination `FF:FF:FF:FF:FF:FF`) : « Qui a 192.168.1.11 ? » (`arp.request`).
3. Chaque machine du réseau local la reçoit. Seul le propriétaire de l'adresse répond, **en unicast** (`arp.reply`) ;
   les autres l'ignorent (`arp.notForMe`).
4. Le répondeur a noté l'émetteur dans son cache (`arp.learn`) ; l'émetteur note la réponse (`arp.cacheUpdate`)
   et le paquet IP qui attendait peut partir.
5. Sans réponse au bout de 12 s simulées, la résolution échoue (`arp.timeout`) et le paquet en attente est abandonné.

Pour sortir de son réseau, un hôte demande la MAC **de sa passerelle**, jamais celle de la destination finale :
c'est `IpNode.sendIp()` (`src/sim/devices/host.js`) qui choisit le prochain saut, ARP ne fait que le résoudre.

## Ce que montre l'inspecteur

Opération (requête 1 / réponse 2), MAC et IP de l'émetteur, MAC et IP cibles. Dans une requête, la MAC cible
vaut `00:00:00:00:00:00` : c'est justement ce que l'on cherche.

## Simplifications pédagogiques

- les entrées du cache n'expirent pas ;
- pas d'ARP gratuit (annonce spontanée) ;
- seul l'équipement visé mémorise l'émetteur de la requête.

## Fonction offerte aux autres modules

`arp.resolve(device, iface, ip, onResolved, onFailed)` : appelle `onResolved(mac, notes)` tout de suite si le cache
connaît l'adresse, sinon à l'arrivée de la réponse. Plusieurs paquets qui attendent la même adresse partagent une seule requête.
