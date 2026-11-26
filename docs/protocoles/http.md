# HTTP — HyperText Transfer Protocol

**Rôle.** Le navigateur demande une page à un serveur web. Ce scénario est la synthèse du catalogue : il enchaîne
ARP, DNS, TCP puis HTTP, exactement comme lorsqu'on tape une adresse dans un navigateur.

| | |
| --- | --- |
| Code | `src/sim/protocols/http.js` |
| Tests | `tests/http.test.js` |
| Scénario | `scenarios/http.json` |
| Couche | application — transporté par TCP, port 80 ; dépend de DNS |
| Action de scénario | `{ "action": "http", "from": "pc1", "url": "http://www.supcom.tn/" }` |

## Enchaînement simulé pour `http://www.supcom.tn/`

| # | Protocole | Ce qui se passe | Explication (clé) |
| --- | --- | --- | --- |
| 1 | DNS (+ ARP) | trouver l'adresse IP de `www.supcom.tn` | `http.start`, `dns.query` |
| 2 | TCP (+ ARP) | ouvrir une connexion vers le port 80 : SYN, SYN-ACK, ACK | `tcp.syn`… |
| 3 | HTTP | `GET /` puis `200 OK` avec la page | `http.request`, `http.response`, `http.rendered` |
| 4 | TCP | fermer la connexion | `tcp.finAck`… |

**Étape 2 du scénario** : `http://www.supcom.tn/inconnu`. Le nom est déjà dans le cache DNS (pas de nouvelle question) ;
le serveur répond `404 Not Found`. L'erreur vient de l'application : du point de vue de TCP, l'échange s'est très bien passé.

Si l'URL contient directement une adresse IP, l'étape DNS est sautée. Si le nom n'existe pas, rien n'est tenté ensuite (`http.dnsFailed`).

Pages du serveur dans le scénario : `"services": { "http": { "port": 80, "pages": { "/": { "title": "…", "body": "…" } } } }`.

## Ce que montre l'inspecteur

Pour une requête : la ligne de requête (méthode et chemin) et l'en-tête `Host`. Pour une réponse : la ligne d'état (code et raison), `Content-Type` et `Content-Length`.
En dessous : l'en-tête TCP (ports, numéros de séquence) puis IP puis Ethernet — les quatre couches d'un coup d'œil.

## Et HTTPS ?

HTTPS ajouterait, entre les étapes 2 et 3, un échange **TLS** : le client et le serveur se mettent d'accord sur des clés,
le serveur prouve son identité par un certificat, puis tout ce qui suit (la requête, la page) circule chiffré sur le port 443.
Un observateur du réseau verrait encore les adresses IP et les ports, mais plus le contenu. Cet échange n'est pas simulé (extension F09).

## Simplifications pédagogiques

- une seule requête par connexion ;
- en-têtes réduits à l'essentiel ;
- la page tient dans un seul segment TCP.
