// Petit serveur web local pour le développement : « npm start » puis http://localhost:8080
// Aucune dépendance. localhost est un « contexte sécurisé » : Service Worker et WebXR
// y fonctionnent sans HTTPS.
//
//   node tools/serve.mjs            port 8080
//   PORT=3000 node tools/serve.mjs  autre port

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, pathname);
  // Sécurité : ne jamais servir un fichier situé hors du dépôt.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`404 — introuvable : ${pathname}`);
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // en développement, toujours la dernière version
    });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`3D Network Topology : http://localhost:${PORT}/`);
  console.log('Arrêt : Ctrl+C');
});
