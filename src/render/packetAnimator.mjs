// Animation des paquets sur les câbles.
//
// Règle centrale : la position d'un paquet est calculée à partir de l'horloge SIMULÉE
// (sim.now) et non du nombre d'images affichées. Conséquences : en pause les paquets se
// figent, à vitesse ×4 ils vont quatre fois plus vite, et un appareil lent affiche
// exactement la même simulation qu'un appareil rapide, simplement avec moins d'images.
//
// Un paquet est une CARTE-MESSAGE : tout ce qu'il faut savoir y est écrit.
//
//      ┌──────────────────────┐
//      │ ICMP Echo Reply      │   type de message (en gras)
//      │ PC3 → PC1            │   qui parle à qui (packetStyles.mjs, packetCaption)
//      └──────────┬───────────┘   liseré de la couleur du protocole ; un clic ouvre l'inspecteur
//                 │               tige
//      ═══════════●═══════════    point lumineux qui glisse sur le câble (render.linkPath)
//
//   - en qualité haute, une courte traînée derrière le point montre le sens du déplacement ;
//   - quand beaucoup de paquets circulent, les cartes éloignées passent en version courte
//     (le type de message seul) ; de près, les deux lignes réapparaissent ;
//   - une trame perdue : la carte devient rouge (« ✕ perdu »), puis tombe et s'efface.
//
// Un paquet arrivé reste visible devant son destinataire jusqu'au départ des paquets
// suivants : après un « pas à pas », on peut ainsi cliquer dessus pour l'inspecter.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.mjs';
import { Topics } from '../sim/events.mjs';
import { packetCaption } from './packetStyles.mjs';

/** Hauteur du point au-dessus de l'axe du câble (il est posé sur la gaine). */
const DOT_LIFT = 0.04;
/** Hauteur de la carte au-dessus du point (longueur de la tige). */
const CARD_HEIGHT = 0.62;
/** Part du câble laissée libre à chaque bout : le paquet s'arrête devant la prise. */
const T_MARGIN = 0.05;
/** Sans câble connu (secours) : départ et arrivée un peu avant le centre de l'équipement, en arc. */
const END_MARGIN = 1.0;
const ARC_HEIGHT = 0.3;
/** Trame perdue : carte rouge (ms simulées), puis chute et effacement jusqu'à LOST_FADE. */
const LOST_STOP = 450;
const LOST_FADE = 1600;
/** Longueur de la traînée derrière le point. */
const TRAIL = 0.9;
/** Cartes complètes jusqu'à ce nombre de paquets ; au-delà, seules les cartes proches le restent. */
const FULL_CARDS_ALWAYS = 4;
const FULL_CARD_DISTANCE = 9; // unités de la topologie
/**
 * Mode classique : en plus de l'échelle d'affichage (render.viewScale), les paquets grossissent
 * encore de ce facteur, pour que la carte se lise depuis la vue d'ensemble.
 */
const CLASSIC_PACKET_BOOST = 1.5;

const TEXTS = {
  fr: { lost: '✕ perdu' },
  en: { lost: '✕ lost' },
};

// Géométries partagées entre tous les paquets (important sur mobile).
const geometries = {
  dot: new THREE.SphereGeometry(0.075, 16, 10),
  stem: new THREE.CylinderGeometry(0.007, 0.007, 1, 6).translate(0, 0.5, 0),
  hit: new THREE.PlaneGeometry(1, 1),
  // Traînée : deux bandes croisées le long de -x (derrière le point), visibles sous tous les angles.
  trail: mergeGeometries([
    new THREE.PlaneGeometry(1, 0.16).translate(-0.5, 0, 0),
    new THREE.PlaneGeometry(1, 0.16).translate(-0.5, 0, 0).rotateX(Math.PI / 2),
  ]),
};

/** Textures dessinées une fois : halo du point (disque flou) et traînée (dégradé). En mode additif, le noir est invisible. */
function gradientTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
let glowMap = null;
let trailMap = null;
function maps() {
  if (glowMap) return;
  glowMap = gradientTexture(64, 64, (g) => {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.35, '#7a7a7a');
    gradient.addColorStop(1, '#000000');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  });
  trailMap = gradientTexture(128, 16, (g) => {
    const along = g.createLinearGradient(0, 0, 128, 0); // gauche = bout de la traînée, droite = point
    along.addColorStop(0, '#000000');
    along.addColorStop(1, '#ffffff');
    g.fillStyle = along;
    g.fillRect(0, 0, 128, 16);
    const across = g.createLinearGradient(0, 0, 0, 16); // bords adoucis
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = across;
    g.fillRect(0, 0, 128, 16);
  });
}

const materials = new Map();
function cached(key, make) {
  if (!materials.has(key)) materials.set(key, make());
  return materials.get(key);
}
const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
const dotMaterial = (color) => cached('dot:' + color, () => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
const glowMaterial = (color) => cached('glow:' + color, () => { maps(); return new THREE.SpriteMaterial({ color, map: glowMap, opacity: 0.9, ...additive }); });
const trailMaterial = (color) => cached('trail:' + color, () => { maps(); return new THREE.MeshBasicMaterial({ color, map: trailMap, side: THREE.DoubleSide, opacity: 0.9, ...additive }); });
const stemMaterial = (color) => cached('stem:' + color, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, toneMapped: false }));
const lostColor = '#ef4444';

export function createPacketAnimator(render, sim) {
  const flights = new Map(); // tx -> trajet en cours ou paquet arrivé
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const here = new THREE.Vector3();

  /** Qui est derrière une adresse IP ou MAC (pour la ligne « PC1 → tous »). */
  function lookup() {
    const byIp = new Map();
    const byMac = new Map();
    for (const def of (sim.scenario && sim.scenario.devices) || []) {
      const live = sim.device(def.id);
      for (const iface of [...(def.interfaces || []), ...((live && live.interfaces) || [])]) {
        if (iface.ip) byIp.set(String(iface.ip).toLowerCase(), def.name);
        if (iface.ipv6) byIp.set(String(iface.ipv6).toLowerCase(), def.name);
        if (iface.mac) byMac.set(String(iface.mac).toUpperCase(), def.name);
      }
    }
    return {
      nameOfIp: (ip) => byIp.get(String(ip).toLowerCase()) || null,
      nameOfMac: (mac) => byMac.get(String(mac).toUpperCase()) || null,
    };
  }

  /** Taille des paquets : 1 dans le laboratoire ; en mode classique, échelle d'affichage × CLASSIC_PACKET_BOOST. */
  const viewScale = () => {
    const k = render.viewScale || 1;
    return k > 1 ? k * CLASSIC_PACKET_BOOST : 1;
  };

  const language = () => ((globalThis.document && document.documentElement.lang) === 'en' ? 'en' : 'fr');

  /** Carte-message : étiquette (sprite) posée au bout de la tige. */
  function card(lines, color, options = {}) {
    const label = render.makeLabel(lines, { size: 0.52, accent: color, ...options });
    if (label) label.position.y = CARD_HEIGHT;
    return label;
  }

  /** Affiche la carte complète ou la carte courte ; la zone cliquable prend sa taille. */
  function show(flight, which) {
    if (flight.shown === which) return;
    flight.shown = which;
    for (const name of ['full', 'short', 'lost']) if (flight.cards[name]) flight.cards[name].visible = name === which;
    const active = flight.cards[which];
    if (active) flight.hit.scale.set(active.scale.x, active.scale.y, 1);
  }

  /** Position et direction d'un paquet à une progression donnée (0 = départ, 1 = arrivée). */
  function locate(flight, progress) {
    if (flight.path) {
      const along = flight.forward ? progress : 1 - progress;
      const t = T_MARGIN + (1 - 2 * T_MARGIN) * along;
      flight.path.curve.getPointAt(t, point);
      flight.path.curve.getTangentAt(t, tangent);
      if (!flight.forward) tangent.negate();
      point.y += DOT_LIFT * viewScale();
    } else {
      point.lerpVectors(flight.from, flight.to, progress);
      point.y += Math.sin(progress * Math.PI) * ARC_HEIGHT;
      tangent.copy(flight.to).sub(flight.from);
    }
    flight.mesh.position.copy(point);
    flight.mesh.scale.setScalar(viewScale()); // mode classique : paquet plus grand (suit un changement de vue)
    // La traînée suit le câble (cap horizontal ; inchangé quand le câble monte vers une prise).
    if (Math.hypot(tangent.x, tangent.z) > 0.2) flight.mesh.rotation.y = Math.atan2(-tangent.z, tangent.x);
  }

  function place(flight, now) {
    // Trame perdue : elle s'arrête sur le câble, sa carte devient rouge, puis tombe et s'efface.
    if (flight.lostAt != null && now >= flight.lostAt) {
      locate(flight, Math.min(1, Math.max(0, (flight.lostAt - flight.start) / flight.duration)));
      if (flight.trail) flight.trail.visible = false;
      if (!flight.cards.lost) {
        flight.cards.lost = card([flight.packet.label, TEXTS[language()].lost], lostColor, { color: '#fee2e2', background: 'rgba(127, 29, 29, 0.94)' });
        if (flight.cards.lost) flight.mesh.add(flight.cards.lost);
        flight.dot.material = dotMaterial(lostColor);
        flight.stem.material = stemMaterial(lostColor);
        flight.glow.material = glowMaterial(lostColor);
        show(flight, 'lost');
      }
      const age = now - flight.lostAt - LOST_STOP;
      if (age > 0) {
        const fade = Math.min(1, age / (LOST_FADE - LOST_STOP));
        if (flight.cards.lost) {
          flight.cards.lost.position.y = CARD_HEIGHT - 0.9 * fade * fade; // elle tombe
          flight.cards.lost.material.opacity = 1 - fade;
        }
        flight.dot.scale.setScalar(1 - fade);
        flight.stem.visible = false;
        flight.glow.visible = fade < 0.5;
        if (fade >= 1) flight.gone = true;
      }
      return;
    }
    const progress = Math.min(1, Math.max(0, (now - flight.start) / flight.duration));
    locate(flight, progress);
    if (flight.trail) {
      // La traînée pousse au départ (elle ne sort pas de la prise) et disparaît à l'arrivée.
      const moving = progress > 0 && progress < 1;
      flight.trail.visible = moving;
      const run = (flight.path ? flight.path.length : flight.from.distanceTo(flight.to)) * (1 - 2 * T_MARGIN);
      flight.trail.scale.x = Math.max(0.01, Math.min(TRAIL, run * progress / viewScale()));
    }
  }

  function remove(tx) {
    const flight = flights.get(tx);
    if (!flight) return;
    render.packetLayer.remove(flight.mesh);
    for (const label of Object.values(flight.cards)) if (label) { label.material.map.dispose(); label.material.dispose(); }
    flights.delete(tx);
  }

  function clear() {
    for (const tx of [...flights.keys()]) remove(tx);
  }

  sim.on(Topics.PACKET_SEND, (event) => {
    // Les paquets arrivés à une date antérieure laissent la place aux nouveaux.
    for (const [tx, flight] of flights) {
      if (flight.arrivedAt !== null && flight.arrivedAt < event.time) remove(tx);
    }
    if (flights.size >= render.maxPackets) return; // garde-fou de fluidité
    const { color } = render.packetStyle(event.packet);

    // Racine : position et cap sur le câble ; c'est elle que l'on sélectionne au clic.
    const mesh = new THREE.Group();
    mesh.userData = { kind: 'packet', packet: event.packet, tx: event.tx };
    const flight = {
      mesh, packet: event.packet, start: event.time, duration: event.duration, arrivedAt: null,
      cards: {}, shown: null, trail: null,
    };

    // Point lumineux sur le câble, son halo, et la tige qui monte à la carte.
    flight.dot = new THREE.Mesh(geometries.dot, dotMaterial(color));
    flight.glow = new THREE.Sprite(glowMaterial(color));
    flight.glow.scale.setScalar(0.42);
    flight.glow.raycast = () => {};
    flight.stem = new THREE.Mesh(geometries.stem, stemMaterial(color));
    flight.stem.scale.y = CARD_HEIGHT - 0.12;
    flight.stem.raycast = () => {};
    mesh.add(flight.dot, flight.glow, flight.stem);

    // La carte : complète (type de message + qui → qui) et courte (type de message seul).
    const caption = packetCaption(event.packet, lookup(), language());
    flight.cards.full = card([event.packet.label, caption], color);
    flight.cards.short = card([event.packet.label], color);
    for (const label of [flight.cards.full, flight.cards.short]) if (label) mesh.add(label);
    // Zone cliquable invisible à la taille de la carte (une étiquette ne se vise pas directement :
    // les visées de la VR et du laboratoire n'ont pas de caméra pour les sprites).
    flight.hit = new THREE.Mesh(geometries.hit, cached('hit', () => new THREE.MeshBasicMaterial({ visible: false })));
    flight.hit.position.y = CARD_HEIGHT;
    mesh.add(flight.hit);
    show(flight, 'full');

    const path = render.linkPath ? render.linkPath(event.linkId) : null;
    if (path && path.curve) {
      flight.path = path;
      flight.forward = path.start === event.from;
    } else {
      const from = render.anchor(event.from);
      const to = render.anchor(event.to);
      const direction = to.clone().sub(from);
      const margin = Math.min(END_MARGIN, direction.length() * 0.3);
      direction.normalize();
      flight.from = from.addScaledVector(direction, margin);
      flight.to = to.addScaledVector(direction, -margin);
    }
    // Traînée : en qualité haute seulement (mobile et VR : un objet de moins par paquet).
    if (!render.quality || render.quality.level !== 'low') {
      flight.trail = new THREE.Mesh(geometries.trail, trailMaterial(color));
      flight.trail.raycast = () => {};
      flight.trail.visible = false;
      mesh.add(flight.trail);
    }
    place(flight, sim.now);
    render.packetLayer.add(mesh);
    flights.set(event.tx, flight);
  });

  sim.on(Topics.PACKET_RECEIVE, (event) => {
    const flight = flights.get(event.tx);
    if (flight) flight.arrivedAt = event.time;
  });

  sim.on(Topics.PACKET_DROP, (event) => {
    if (!event.onLink) return;
    const flight = flights.get(event.tx);
    if (flight) flight.lostAt = event.time;
  });
  sim.on(Topics.RESET, clear);
  sim.on(Topics.SCENARIO_LOADED, clear);

  render.onFrame(() => {
    const now = sim.now;
    const crowded = flights.size > FULL_CARDS_ALWAYS;
    render.camera.getWorldPosition(eye);
    const scaleFactor = render.world ? render.world.scale.x || 1 : 1;
    for (const [tx, flight] of flights) {
      place(flight, now);
      if (flight.gone) { remove(tx); continue; }
      // La zone cliquable regarde la caméra, comme la carte.
      flight.hit.lookAt(eye);
      if (flight.shown === 'lost') continue;
      // Beaucoup de paquets : carte complète de près, carte courte de loin.
      let full = true;
      if (crowded) {
        flight.hit.getWorldPosition(here);
        full = eye.distanceTo(here) / scaleFactor < FULL_CARD_DISTANCE;
      }
      show(flight, full ? 'full' : 'short');
    }
  });

  return { flights, clear };
}
