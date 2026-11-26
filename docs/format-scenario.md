# Format des fichiers de scénario

> **Contrat commun.** Toute modification de ce format passe par une pull request approuvée
> par les quatre membres. Le code qui le vérifie est `src/sim/scenario.js` (`validateScenario`).

Un scénario est un fichier JSON du dossier `scenarios/`. Il décrit **une topologie** (équipements,
adresses, câbles) et **des étapes** à jouer. Ajouter un scénario ne demande aucune ligne de
JavaScript : on écrit le fichier, puis on l'ajoute au catalogue `scenarios/index.json`.

## Exemple minimal

```json
{
  "format": 1,
  "id": "mon-scenario",
  "title":   { "fr": "Mon scénario", "en": "My scenario" },
  "summary": { "fr": "Ce que l'on va voir.", "en": "What we are going to see." },
  "protocols": ["arp", "icmp"],
  "devices": [
    { "id": "pc1", "type": "host", "name": "PC1", "position": [-4, 0, 0],
      "interfaces": [{ "name": "eth0", "mac": "02:00:00:00:01:10", "ip": "192.168.1.10", "prefix": 24 }] },
    { "id": "sw1", "type": "switch", "name": "SW1", "position": [0, 0, 0] },
    { "id": "pc2", "type": "host", "name": "PC2", "position": [4, 0, 0],
      "interfaces": [{ "name": "eth0", "mac": "02:00:00:00:01:11", "ip": "192.168.1.11", "prefix": 24 }] }
  ],
  "links": [
    { "id": "l1", "a": "pc1:eth0", "b": "sw1:p1" },
    { "id": "l2", "a": "pc2:eth0", "b": "sw1:p2" }
  ],
  "steps": [
    { "action": "ping", "from": "pc1", "to": "pc2",
      "title": { "fr": "Ping PC1 → PC2", "en": "Ping PC1 → PC2" } }
  ]
}
```

## Champs de premier niveau

| Champ | Obligatoire | Description |
| --- | --- | --- |
| `format` | oui | version du format : `1` |
| `id` | oui | identifiant en minuscules, chiffres et tirets ; **égal au nom du fichier** sans `.json` |
| `title`, `summary` | oui | textes `{ "fr": …, "en": … }` |
| `objectives` | non | `{ "fr": [ … ], "en": [ … ] }` : ce qu'il faut observer |
| `protocols` | oui | protocoles à charger (`src/sim/protocols/<id>.js`) ; leurs dépendances suivent toutes seules |
| `devices` | oui | équipements (au moins un) |
| `links` | non | câbles |
| `steps` | oui | étapes jouées dans l'ordre (la liste peut être vide) |
| `explanations` | non | `{ "clé": { "fr", "en" } }` : remplace le texte d'une explication pour ce scénario |

## Équipements (`devices`)

| Champ | Description |
| --- | --- |
| `id` | identifiant unique dans le scénario |
| `type` | `host` (PC), `server`, `switch` ou `router` |
| `name` | nom affiché |
| `position` | `[x, y, z]` en unités de la scène (y = 0 : posé au sol) |
| `interfaces` | liste de `{ name, mac, ip?, prefix? }` — obligatoire sauf pour un switch |
| `gateway` | passerelle par défaut (hôtes) |
| `dns` | serveur DNS utilisé par l'hôte |
| `routes` | routes statiques d'un routeur : `[{ network, prefix, via }]` |
| `services` | applications d'un serveur : `udp.listen`, `tcp.listen`, `dns.records`, `dhcp`, `http.pages` |
| `model` | modèle du catalogue (`src/sim/catalog.js`), ex. `sw-24g`, `pc-fe` ; sinon le modèle par défaut du type |

| `type: "firewall"` | pare-feu à états (laboratoire) : comme un routeur, plus des zones sur ses interfaces |
| `vlans` | switch administrable : `{ "10": "ADMIN", "20": "ETUDIANTS" }` (le VLAN 1 existe toujours) |
| `ports` | switch administrable, réglages par port : `{ "p1": { "vlan": 10 }, "u1": { "mode": "trunk", "allowed": [10, 20], "native": 1 }, "p5": { "security": { "maximum": 1, "sticky": true, "violation": "shutdown", "macs": [] } } }` |
| `acls` | listes d'accès : `{ "WEB": [{ "action": "permit", "proto": "tcp", "src": "any", "dst": "host 172.16.1.80", "port": 80 }] }` — `src` / `dst` : `any`, `host A`, `A/longueur` ; refus implicite à la fin |
| `nat` | `[{ "type": "static", "inside": "172.16.1.80", "outside": "203.0.113.5" }, { "type": "overload", "acl": "LAN" }]` |

Champs d'interface ajoutés (routeur, pare-feu) : `vlan` et `parent` implicite pour une sous-interface `g0/0.10` ;
`shutdown: true` ; `description` ; `acl: { "in": "WEB", "out": … }` ; `nat: "inside" | "outside"` ;
`zone: "inside" | "dmz" | "outside"` et `level` (0 à 100) sur un pare-feu. Toutes ces valeurs sont aussi réglables à
la console (`docs/console.md`).

Règles vérifiées : adresses MAC au format `AA:BB:CC:DD:EE:FF` et uniques ; adresses IPv4 valides ;
`prefix` entre 1 et 30 ; une interface sans `ip` est permise (poste qui attend DHCP).
Un switch n'a ni MAC ni IP : ses ports sont déclarés par les câbles (`sw1:p1`).

## Câbles (`links`)

`{ "id": "l1", "a": "pc1:eth0", "b": "sw1:p1" }` — chaque extrémité s'écrit `équipement:interface`.
Une interface ne reçoit qu'un seul câble.

Champs facultatifs (débit, voir `docs/debit.md`) : `cable` (`cat5`, `cat5e`, `cat6` par défaut,
`cat6a`, `fibre`) et `length` en mètres (10 par défaut). Une interface peut imposer sa vitesse
avec `"speed": 10 | 100 | 1000 | 10000` (Mb/s). La vitesse d'un lien est la plus petite de
celles des deux cartes et du câble.

## Étapes (`steps`)

Chaque étape lance une **action**. Le protocole qui déclare cette action dans `actions` la prend en charge.

| Action | Protocole | Paramètres |
| --- | --- | --- |
| `trace` | (intégrée) | `path: [ids…]`, `label?`, `protocol?` — paquet de test qui suit un chemin |
| `ping` | `icmp` | `from`, `to` (identifiant ou adresse IP), `count?`, `ttl?` |
| `udp` | `udp` | `from`, `to`, `port`, `data?` |
| `dns` | `dns` | `from`, `name` |
| `dhcp` | `dhcp` | `from` |
| `tcp` | `tcp` | `from`, `to`, `port`, `data?` |
| `http` | `http` | `from`, `url` |
| `ping6` | `ipv6` | `from`, `to` |
| `tcp` (transfert) | `tcp` | `from`, `to`, `port`, `size` (octets), `window?` (segments, 4 par défaut), `lose?` (numéros des segments perdus, à partir de 0) |
| `group` | (intégrée) | `steps: [ … ]` — plusieurs étapes jouées en même temps |

`title` et `explanation` (`{ fr, en }`) sont facultatifs : ils s'affichent dans le panneau des explications.
L'étape suivante démarre quand plus aucun paquet ne circule.

## Catalogue (`scenarios/index.json`)

```json
{ "default": "ping.json",
  "scenarios": [ { "file": "ping.json", "title": { "fr": "…", "en": "…" } } ] }
```

`default` est le scénario ouvert au démarrage. `?scenario=tcp` dans l'adresse en ouvre un autre.
