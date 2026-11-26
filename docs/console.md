# Consoles des équipements — référence des commandes

> Laboratoire de Steve (S7). Code : `src/sim/cli.js` (interpréteur), `src/sim/config.js` (modifications du
> scénario). Tests : `tests/cli.test.js`. Mode d'emploi du laboratoire : `laboratoire.md`.

Chaque équipement administrable a une console. Son **style** dépend du système de son modèle
(`src/sim/catalog.js`, champ `os`) :

| Style | Systèmes (fictifs) | Équipements |
| --- | --- | --- |
| **IOS** | NetCore OS 15, Shield OS 9 | routeurs RX-2G / RX-4G, switch CX-24M, pare-feu SG-3 / SG-8X |
| **VRP** | Versa NOS 8 | routeur VR-2, switch VS-24 |
| **PC** | invite de commandes | PC et serveurs |

Les switchs non administrables (CX-8G, CX-8F, CX-24G) n'ont pas de console.

## Comportements communs (IOS et VRP)

- **Abréviations** : chaque mot peut être raccourci tant qu'il reste unique (`sh ip int br`, `conf t`, `int g0/1`).
  Une abréviation ambiguë (`c`) est signalée, comme sur le vrai matériel.
- **`?`** en fin de ligne : les mots possibles à cet endroit, avec leur explication.
- **Tab** : complète le mot en cours.
- **↑ / ↓** : historique des commandes.
- **`do`** (IOS) : lancer une commande du mode privilégié depuis la configuration (`do show ip route`).
- **Noms d'interfaces** : `GigabitEthernet0/3`, `gi0/3`, `g0/3` (IOS) ou `GigabitEthernet0/0/3`, `GE0/0/3` (VRP) ;
  les ports 10 Gb/s s'appellent `TenGigabitEthernet1/1` (IOS) ou `XGigabitEthernet0/0/1` (VRP).
- Une commande de configuration **modifie le scénario** : le réseau est relancé aussitôt (« configuration
  appliquée »). Une commande refusée (adresse invalide, IP sur un port de switch…) ne change rien et dit pourquoi.

## Style IOS

| Mode (invite) | Entrer / sortir |
| --- | --- |
| utilisateur `R1>` | `enable` → privilégié |
| privilégié `R1#` | `configure terminal` → configuration ; `disable` → utilisateur |
| configuration `R1(config)#` | `interface …`, `vlan …`, `ip access-list extended …` ; `exit` / `end` (ou Ctrl+Z) |
| interface `R1(config-if)#` · VLAN `(config-vlan)#` · ACL `(config-ext-nacl)#` | `exit` remonte d'un niveau, `end` revient au mode privilégié |

**Afficher** : `show version`, `show running-config`, `show ip interface brief`, `show ip route`, `show arp`,
`show mac address-table`, `show vlan brief`, `show interfaces trunk`, `show port-security`, `show access-lists`,
`show ip nat translations`, `show conn` (pare-feu), `show cdp neighbors`.

**Tester** : `ping <ip>`, `traceroute <ip>` — l'échange est joué dans la scène, le résultat (`!!!!!`, taux de
réussite) s'affiche à la fin.

**Configurer**

| Besoin | Commandes |
| --- | --- |
| Nom | `hostname R1` |
| Adresse d'interface | `interface g0/0` · `ip address 10.0.1.1 255.255.255.0` · `no shutdown` |
| Éteindre / rallumer | `shutdown` / `no shutdown` (le câble devient rouge foncé) |
| Description | `description vers le FAI` |
| Route statique | `ip route 10.0.2.0 255.255.255.0 10.0.12.2` (et `no ip route …`) |
| Sous-interface (router-on-a-stick) | `interface g0/0.10` · `encapsulation dot1q 10` · `ip address 192.168.10.1 255.255.255.0` |
| VLAN | `vlan 30` · `name INVITES` |
| Port d'accès | `interface gi0/5` · `switchport mode access` · `switchport access vlan 30` |
| Trunk | `switchport mode trunk` · `switchport trunk allowed vlan 10,20,30` · `switchport trunk native vlan 99` |
| Sécurité de port | `switchport port-security` · `… maximum 1` · `… mac-address sticky` · `… mac-address 0200.0000.5e12` · `… violation shutdown|restrict|protect` |
| ACL nommée | `ip access-list extended WEB` · `permit tcp any host 172.16.1.80 eq 80` · `deny icmp any any` · `no 10` |
| ACL numérotée | `access-list 101 permit ip 192.168.1.0 0.0.0.255 any` |
| Appliquer une ACL | `interface g0/1` · `ip access-group WEB in` (ou `out`) |
| NAT | `ip nat inside` / `ip nat outside` sur les interfaces · `ip nat inside source list 1 interface g0/1 overload` · `ip nat inside source static 172.16.1.80 203.0.113.5` |
| Pare-feu (zones) | `interface g0/2` · `nameif dmz` · `security-level 50` |
| Enregistrer | `write memory` / `copy running-config startup-config` |

## Style VRP

| Vue (invite) | Entrer / sortir |
| --- | --- |
| utilisateur `<SW1>` | `system-view` → système |
| système `[SW1]` | `interface …`, `vlan …`, `acl …` ; `quit` remonte, `return` revient à `<SW1>` |

**Afficher** : `display version`, `display current-configuration`, `display ip interface brief`,
`display ip routing-table`, `display arp`, `display mac-address`, `display vlan`, `display port-security`,
`display acl all`, `display nat session all`.

**Configurer**

| Besoin | Commandes |
| --- | --- |
| Nom | `sysname SW1` |
| Adresse | `interface GigabitEthernet0/0/0` · `ip address 10.0.1.1 24` (ou masque complet) · `undo shutdown` |
| Route statique | `ip route-static 10.0.2.0 24 10.0.12.2` |
| VLAN | `vlan batch 10 20` ou `vlan batch 10 to 12` · `vlan 10` · `description ADMIN` |
| Port d'accès | `port link-type access` · `port default vlan 10` |
| Trunk | `port link-type trunk` · `port trunk allow-pass vlan 10 20` (ou `all`) · `port trunk pvid vlan 99` |
| Sous-interface | `interface GigabitEthernet0/0/0.10` · `dot1q termination vid 10` · `ip address 192.168.10.1 24` |
| Sécurité de port | `port-security enable` · `port-security max-mac-num 1` · `port-security mac-address sticky` · `port-security protect-action restrict` |
| ACL | `acl name WEB advance` (ou `acl number 3000`) · `rule permit tcp destination 192.168.10.5 0 destination-port eq 80` · `undo rule 5` |
| Appliquer une ACL | `traffic-filter inbound acl name WEB` |
| NAT | `nat outbound 2000` (PAT sur l'interface) · `nat static global 203.0.113.5 inside 172.16.1.80` |
| Annuler | `undo …` devant la commande |
| Enregistrer | `save` |

## Invite de commandes du PC

`help`, `ipconfig` (`/all`, `/renew` pour le DHCP), `arp -a`, `ping <ip|nom>`, `tracert <ip>`, `nslookup <nom>`,
`curl <adresse>` (page web), `hostname`, `cls`, et pour changer l'adresse :

```
netsh interface ip set address "eth0" static 192.168.1.50 255.255.255.0 192.168.1.1
netsh interface ip set dns "eth0" static 192.168.1.53
```

## Pour les développeurs

`createConsole(api, deviceId)` retourne `{ dialect, prompt(), banner(), execute(line), help(line), complete(line),
history() }`. `execute` renvoie `{ lines, error?, scenario?, run?, clear? }` :

- `scenario` : le nouveau scénario, déjà validé, à recharger (`sim.loadScenario`, ou l'éditeur s'il est ouvert) ;
- `run` : les étapes à jouer (`sim.runActions(run.steps)`) puis `formatRun(dialect, run, réponses)` pour écrire le
  résultat dans le style de la console.

Ajouter une commande : une ligne `add(modes, 'mots {param}', 'aide', (args) => …)` dans `cli.js` ; les paramètres
connus sont `{ip}`, `{mask}`, `{num}`, `{word}`, `{iface}`, `{vlans}`, `{mac}`, `{rest}`. Une modification passe
par une fonction pure de `config.js`, testable sans interface.
