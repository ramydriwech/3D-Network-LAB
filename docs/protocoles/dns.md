# DNS — Domain Name System

**Rôle.** Traduire un nom (`www.supcom.tn`) en adresse IP.

| | |
| --- | --- |
| Code | `src/sim/protocols/dns.js` |
| Tests | `tests/dns.test.js` |
| Scénario | `scenarios/dns.json` |
| Couche | application — transporté par UDP, port 53 |
| Action de scénario | `{ "action": "dns", "from": "pc1", "name": "www.supcom.tn" }` |

## Déroulement du scénario

1. **Résoudre `www.supcom.tn`.** PC1 envoie une question à son serveur DNS (`dns.query`). Comme pour tout premier
   échange, ARP trouve d'abord la MAC du serveur. Le serveur répond avec l'adresse (`dns.response`) ; PC1 la garde en cache (`dns.resolved`).
2. **Un nom qui n'existe pas.** Le serveur répond « NXDOMAIN » (`dns.nxdomain`) : la résolution échoue (`dns.failed`).
3. **La même question une seconde fois.** PC1 trouve la réponse dans son cache DNS (`dns.cacheHit`) : aucun paquet ne circule.

Configuration dans le scénario : l'hôte indique son serveur (`"dns": "192.168.1.53"`), le serveur ses enregistrements
(`"services": { "dns": { "records": { "www.supcom.tn": "192.168.1.80" } } }`).

## Ce que montre l'inspecteur

Identifiant de transaction (le même dans la question et dans la réponse), nature du message (question ou réponse), nom demandé, code de réponse et adresse trouvée.
Sous la couche DNS, l'inspecteur montre l'en-tête UDP (port 53) : DNS est bien un passager d'UDP.

## Simplifications pédagogiques

- un seul serveur qui connaît toutes les réponses : pas de résolution récursive (racine → `.tn` → `supcom.tn`) ;
- enregistrements de type A uniquement ;
- les entrées du cache n'expirent pas (pas de TTL DNS).

## Utilisé par

HTTP : avant d'ouvrir la connexion TCP, le navigateur simulé résout le nom de l'URL avec `dns.resolve()`.
