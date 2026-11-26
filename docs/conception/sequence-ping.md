# Diagramme de séquence du ping

Scénario `scenarios/ping.json`, étape 1 : **PC1 (192.168.1.10) envoie un ping à PC2 (192.168.1.11)**,
dans le même réseau, caches ARP et table MAC vides au départ.

```mermaid
sequenceDiagram
  autonumber
  participant PC1 as PC1<br/>192.168.1.10
  participant SW1 as SW1 (switch)
  participant PC2 as PC2<br/>192.168.1.11
  participant R1 as R1<br/>192.168.1.1

  Note over PC1: PC2 est dans mon réseau,<br/>mais je ne connais pas sa MAC
  PC1->>SW1: ARP Request (diffusion) « Qui a 192.168.1.11 ? »
  Note over SW1: apprend MAC de PC1 sur p1<br/>diffusion : recopie sur p2 et p3
  SW1->>PC2: ARP Request
  SW1->>R1: ARP Request
  Note over R1: ce n'est pas mon adresse : ignoré
  Note over PC2: note PC1 dans son cache ARP
  PC2->>SW1: ARP Reply (unicast) « 192.168.1.11 est à …:01:11 »
  Note over SW1: apprend MAC de PC2 sur p2<br/>destination connue : sortie par p1 seulement
  SW1->>PC1: ARP Reply
  Note over PC1: cache ARP : 192.168.1.11 → …:01:11
  PC1->>SW1: ICMP Echo Request (seq 1, TTL 64)
  SW1->>PC2: ICMP Echo Request
  PC2->>SW1: ICMP Echo Reply (seq 1)
  SW1->>PC1: ICMP Echo Reply
  Note over PC1: ping réussi
```

Ce qu'il faut retenir :

1. **ARP précède toujours le premier paquet IP** vers une adresse dont la MAC est inconnue.
2. La requête ARP est une **diffusion** (tout le réseau local la reçoit) ; la réponse est **unicast**.
3. Le switch **apprend** les adresses MAC à chaque trame reçue, puis cesse d'inonder ses ports.

## Étape 2 : ping vers un autre réseau (PC1 → PC3, à travers R1)

```mermaid
sequenceDiagram
  autonumber
  participant PC1 as PC1<br/>192.168.1.10
  participant R1 as R1 (routeur)<br/>.1.1 | .2.1
  participant PC3 as PC3<br/>192.168.2.10

  Note over PC1: PC3 n'est pas dans mon réseau :<br/>je passe par ma passerelle 192.168.1.1
  PC1->>R1: ARP Request « Qui a 192.168.1.1 ? »
  R1->>PC1: ARP Reply
  PC1->>R1: ICMP Echo Request — IP dst = PC3, MAC dst = R1
  Note over R1: table de routage : 192.168.2.0/24 directement connecté<br/>TTL 64 → 63
  R1->>PC3: ARP Request « Qui a 192.168.2.10 ? »
  PC3->>R1: ARP Reply
  R1->>PC3: ICMP Echo Request — IP inchangées, nouvelles MAC
  PC3->>R1: ICMP Echo Reply
  Note over R1: TTL 64 → 63
  R1->>PC1: ICMP Echo Reply
  Note over PC1: ping réussi (TTL reçu : 63)
```

Les switches SW1 et SW2, transparents pour IP, sont omis de ce second diagramme.

4. Pour sortir de son réseau, PC1 cherche la MAC **de la passerelle**, pas celle de PC3.
5. À chaque routeur, les **adresses MAC changent**, les **adresses IP restent**, le **TTL diminue de 1**.

## Correspondance avec le code

| Message du diagramme | Code | Explication affichée (clé) |
| --- | --- | --- |
| choix remise directe / passerelle | `IpNode.sendIp()` — `src/sim/devices/host.js` | `host.direct`, `host.viaGateway` |
| ARP Request / Reply | `resolve()`, `receive()` — `src/sim/protocols/arp.js` | `arp.request`, `arp.reply`, `arp.cacheUpdate` |
| apprentissage et inondation | `Switch.receive()` — `src/sim/devices/switch.js` | `switch.learn`, `switch.flood.broadcast`, `switch.forward` |
| ICMP Echo Request / Reply | `sendEcho()`, `receive()` — `src/sim/protocols/icmp.js` | `icmp.echoRequest`, `icmp.echoReply`, `icmp.success` |
| relais et TTL | `Router.forward()` — `src/sim/devices/router.js` | `router.lookup`, `router.ttl`, `router.forward` |

La suite exacte des messages est figée dans `tests/golden/ping.txt` et vérifiée par `tests/regression.test.js`.
