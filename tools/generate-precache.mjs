// Génère precache-manifest.js : la liste des fichiers que le Service Worker (sw.js) met
// en cache pour l'usage hors ligne, avec une version calculée d'après leur contenu.
//
// Lancé automatiquement par « npm start » et par la CI avant chaque déploiement : personne
// n'a besoin de tenir cette liste à la main, et un fichier ajouté n'est jamais oublié.
//
//   node tools/generate-precache.mjs           écrit precache-manifest.js
//   node tools/generate-precache.mjs --print   affiche la liste sans rien écrire

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = 'precache-manifest.js';

/** Fichiers de la racine nécessaires à l'exécution. */
export const ROOT_FILES = ['index.html', 'styles.css', 'main.js', 'simulation.js', 'manifest.json'];
/** Dossiers entièrement mis en cache. Les tests, la doc et les outils n'en font pas partie. */
export const DIRECTORIES = ['src', 'scenarios', 'assets', 'vendor'];
/** Fichiers présents dans ces dossiers mais inutiles au navigateur. */
const IGNORED = /(^|\/)(\.[^/]*|LICENSE|VERSION|README\.md)$/;

function walk(directory, base, found) {
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, found);
    else found.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return found;
}

/** Liste triée des chemins (relatifs à la racine du site) à mettre en cache. */
export function listFiles(root = DEFAULT_ROOT) {
  const files = ROOT_FILES.filter((file) => fs.existsSync(path.join(root, file)));
  for (const directory of DIRECTORIES) {
    const full = path.join(root, directory);
    if (fs.existsSync(full)) walk(full, root, files);
  }
  return files.filter((file) => !IGNORED.test(file)).sort();
}

/** { version, files } : la version est une empreinte des chemins et des contenus. */
export function buildManifest(root = DEFAULT_ROOT) {
  const files = listFiles(root);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  // sw.js fait partie de l'empreinte : le modifier doit aussi renouveler le cache.
  if (fs.existsSync(path.join(root, 'sw.js'))) hash.update(fs.readFileSync(path.join(root, 'sw.js')));
  // './' : la page elle-même, pour que l'adresse du site s'ouvre hors ligne.
  return { version: hash.digest('hex').slice(0, 12), files: ['./', ...files] };
}

export function render(manifest) {
  return '// FICHIER GÉNÉRÉ par tools/generate-precache.mjs — ne pas modifier à la main.\n'
    + `self.__PRECACHE = ${JSON.stringify(manifest, null, 2)};\n`;
}

// Exécuté directement (et non importé par un test) ? Comparaison sur le nom du fichier : elle
// reste juste sous Windows, où la casse de la lettre du lecteur peut varier.
if (process.argv[1] && import.meta.url.endsWith('/' + path.basename(process.argv[1]))) {
  const manifest = buildManifest();
  if (process.argv.includes('--print')) {
    console.log(manifest.files.join('\n'));
  } else {
    fs.writeFileSync(path.join(DEFAULT_ROOT, OUTPUT), render(manifest));
    console.log(`${OUTPUT} : ${manifest.files.length} fichiers, version ${manifest.version}`);
  }
}
