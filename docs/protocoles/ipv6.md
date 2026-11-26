# IPv6 simplifié (extension F09)

**Rôle.** Montrer la différence la plus visible entre IPv4 et IPv6 sur un réseau local : **ARP disparaît**, remplacé par
la découverte de voisin (NDP), transportée par ICMPv6 et envoyée en **multidiffusion** au lieu d'une diffusion générale.

| | |
| --- | --- |
| Code | `src/sim/protocols/ipv6.js` |
| Tests | `tests/ipv6.test.js` |
| Scénario | `scenarios/ipv6.json` |
| Couche | réseau |
| Action de scénario | `{ "action": "ping6", "from": "pc1", "to": "pc2" }` |

## Déroulement simulé

| # | Message ICMPv6 | Type | Destination | Équivalent IPv4 |
| --- | --- | --- | --- | --- |
| 1 | Neighbor Solicitation | 135 | groupe `ff02::1:ffXX:XXXX`, MAC `33:33:FF:XX:XX:XX` | ARP Request (diffusion) |
| 2 | Neighbor Advertisement | 136 | unicast | ARP Reply |
| 3 | Echo Request | 128 | unicast | ICMP Echo Request |
| 4 | Echo Reply | 129 | unicast | ICMP Echo Reply |

Le groupe visé par la sollicitation se calcule avec les 24 derniers bits de l'adresse cherchée : pour `2001:db8:6::11`,
c'est `ff02::1:ff00:11`, et l'adresse MAC `33:33:FF:00:00:11`. Seules les machines dont l'adresse se termine pareil y sont
abonnées. Le switch, lui, inonde toujours la trame ; mais la carte réseau de PC3 l'écarte sans déranger le système (`ipv6.notForMe`).

Au second ping, le **cache de voisins** (affiché dans le panneau d'infos) évite une nouvelle sollicitation (`ipv6.cacheHit`).

L'adresse IPv6 d'une interface s'écrit dans le scénario : `{ "name": "eth0", "mac": "…", "ipv6": "2001:db8:6::10" }`.

## Simplifications pédagogiques

- un seul lien : pas de routage IPv6 ;
- préfixe /64 supposé ; pas d'adresse lien-local, pas d'autoconfiguration (SLAAC), pas d'annonce de routeur ;
- le cache de voisins n'expire pas.
