# Audit Lighthouse

Tâche n° 70 (S6) : lancer un audit Lighthouse sur le site déployé et noter les résultats.

## Comment lancer l'audit

1. Ouvrir le site **déployé** (URL HTTPS de GitHub Pages) dans Chrome, en **navigation privée** : les extensions faussent les mesures.
2. Outils de développement (F12) → onglet **Lighthouse**.
3. Mode *Navigation*, appareil **Mobile**, catégories : Performance, Accessibilité, Bonnes pratiques, SEO.
4. Cliquer sur *Analyser le chargement de la page*. Refaire la mesure en mode **Ordinateur**.
5. Faire trois mesures et garder la médiane : le score de performance varie d'un essai à l'autre.

En ligne de commande (facultatif) : `npx lighthouse https://<compte>.github.io/<depot>/ --view`.

> Les versions récentes de Lighthouse n'ont plus de catégorie « PWA ». Les critères d'installation se vérifient dans
> **Application → Manifest** (rubrique *Installability*) et **Application → Service workers** : voir la seconde liste ci-dessous.

## Résultats

| Date | Version du site | Appareil | Performance | Accessibilité | Bonnes pratiques | SEO | Auditeur |
| --- | --- | --- | --- | --- | --- | --- | --- |
| *à remplir* | | Mobile | | | | | Ayoub |
| *à remplir* | | Ordinateur | | | | | Ayoub |

Mesures principales (mobile) :

| Mesure | Valeur | Commentaire |
| --- | --- | --- |
| First Contentful Paint | | |
| Largest Contentful Paint | | |
| Total Blocking Time | | |
| Cumulative Layout Shift | | |
| Poids total transféré | | Three.js représente l'essentiel du JavaScript |

> **Ces tableaux sont à remplir sur le site réellement déployé.** Aucun chiffre n'y est inscrit d'avance : un audit
> ne vaut que s'il a été mesuré.

## Critères PWA (vérification manuelle)

| Critère | Où le vérifier | Attendu | Résultat |
| --- | --- | --- | --- |
| Site servi en HTTPS | barre d'adresse | cadenas | |
| Manifest valide : `name`, `short_name`, `start_url`, `display: standalone` | Application → Manifest | aucune erreur | |
| Icônes 192 × 192 et 512 × 512, plus une icône *maskable* | Application → Manifest | les trois affichées | |
| Service Worker actif | Application → Service workers | *activated and is running* | |
| Application installable | icône d'installation dans la barre d'adresse, ou notre bouton | proposée | |
| Rechargement hors ligne | Network → Offline, puis F5 | l'application s'affiche | |
| `theme-color` défini | Application → Manifest | `#0b1220` | |

## Points déjà traités dans le code

| Sujet | Mesure prise |
| --- | --- |
| Poids | aucun framework ; Three.js est la seule bibliothèque ; modèles GLB de quelques kilo-octets |
| Requêtes externes | aucune (pas de CDN, pas de police distante) |
| Mise en cache | tous les fichiers pré-cachés par le Service Worker ; affichage immédiat à la deuxième visite |
| Accessibilité | vrais boutons, `aria-label`, navigation au clavier, `lang` mis à jour avec la langue, contrastes du thème sombre |
| Mobile | `viewport` défini, cibles tactiles d'au moins 44 px, densité de pixels plafonnée |

## Limite connue

Lighthouse juge une page de contenu. Une scène 3D plein écran ne peut pas être « lue » par un lecteur d'écran :
les panneaux (explications, journal, inspecteur) en donnent l'équivalent textuel, mis à jour en direct (`aria-live`).

## Actions décidées après l'audit

| Problème signalé par Lighthouse | Décision | Fait |
| --- | --- | --- |
| *à remplir* | | |
