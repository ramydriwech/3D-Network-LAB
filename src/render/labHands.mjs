// Les mains de Steve dans le laboratoire (vue à la première personne, à l'écran).
//
// Deux mains humaines accrochées à la caméra, en bas du champ de vision : paume arrondie, quatre
// doigts de trois phalanges (de longueurs différentes, l'auriculaire plus court), pouce opposable,
// ongles, poignet, avant-bras et manche de blouse blanche. Elles suivent ce que fait Steve :
//   - au repos, détendues, elles se balancent un peu au rythme de la marche ;
//   - « prendre », « poser », « brancher » : la main droite se tend vers l'avant puis revient ;
//   - un équipement porté est saisi PAR LES CÔTÉS : paumes tournées vers lui, doigts repliés
//     dessous ; les mains restent hors de l'équipement (setHeld) ;
//   - l'objet pris glisse de l'étagère (ou de son meuble) jusqu'aux mains, et à la pose il glisse
//     des mains jusqu'à sa place (dropTo) ;
//   - un meuble se pousse : paumes ouvertes vers l'avant (setPushing) ;
//   - un câble : le rouleau dans la main gauche, la fiche pincée entre le pouce et l'index de la
//     droite ; une fois le premier bout branché, le câble pend de la prise jusqu'à la main (setCable).
// En VR (les manettes servent de mains) et en survol, elles sont masquées.

import * as THREE from 'three';

const shared = new Map();
const once = (key, make) => { if (!shared.has(key)) shared.set(key, make()); return shared.get(key); };
const material = (key, color, extra = {}) => once(key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra }));
const SKIN = () => material('m:skin', 0xc8906c, { roughness: 0.58 });
const NAIL = () => material('m:nail', 0xe9c9bb, { roughness: 0.3 });
const SLEEVE = () => material('m:labcoat', 0xf1f3f5, { roughness: 0.9 });
const CUFF = () => material('m:labcoatCuff', 0xdfe3e8, { roughness: 0.85 });

/** Capsule couchée le long de -z, de longueur totale `length` (de z = 0 à z = -length). */
function segmentGeometry(radius, length) {
  return once(`g:seg:${radius}:${length}`, () => {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, length + 0.004 - 2 * radius), 6, 12);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -length / 2 + 0.002);
    return g;
  });
}

// Doigts, du côté du pouce vers l'auriculaire : écart (m), longueurs des trois phalanges, rayon.
const FINGERS = [
  { x: 0.0255, lengths: [0.042, 0.026, 0.021], radius: 0.0096, base: -0.086 },
  { x: 0.0085, lengths: [0.046, 0.029, 0.022], radius: 0.0098, base: -0.09 },
  { x: -0.0085, lengths: [0.043, 0.027, 0.021], radius: 0.0093, base: -0.087 },
  { x: -0.0245, lengths: [0.034, 0.021, 0.018], radius: 0.0083, base: -0.08 },
];
/** Ongle : un ovale bombé, à moitié enfoncé dans le bout du doigt (pas une plaquette posée dessus). */
const nailGeometry = () => once('g:nailOval', () => new THREE.SphereGeometry(1, 14, 8));

/**
 * Une main humaine (repère : paume vers -y, doigts vers -z, poignet en z = 0), avec avant-bras
 * et manche. side : -1 main gauche, 1 main droite (le pouce est du côté -x pour la droite).
 */
function buildHand(side) {
  const hand = new THREE.Group();
  // Paume : capsule aplatie, plus large côté doigts.
  const palm = new THREE.Mesh(once('g:palm', () => {
    const g = new THREE.CapsuleGeometry(0.03, 0.034, 6, 14);
    g.rotateX(Math.PI / 2);
    g.scale(1.38, 0.5, 1.12);
    return g;
  }), SKIN());
  palm.position.set(0, 0, -0.048);
  hand.add(palm);
  // Poignet, avant-bras, manche de blouse et son revers.
  const wrist = new THREE.Mesh(once('g:wrist', () => new THREE.CylinderGeometry(0.024, 0.029, 0.13, 14).rotateX(Math.PI / 2)), SKIN());
  wrist.position.set(0, 0.002, 0.055);
  wrist.scale.set(1.15, 0.85, 1);
  hand.add(wrist);
  const sleeve = new THREE.Mesh(once('g:sleeve', () => new THREE.CylinderGeometry(0.047, 0.055, 0.32, 16, 1, true).rotateX(Math.PI / 2)), SLEEVE());
  sleeve.material.side = THREE.DoubleSide;
  sleeve.position.set(0, 0, 0.27);
  hand.add(sleeve);
  const cuff = new THREE.Mesh(once('g:cuff', () => new THREE.TorusGeometry(0.046, 0.007, 8, 20)), CUFF());
  cuff.position.set(0, 0, 0.112);
  hand.add(cuff);
  // Doigts : trois phalanges articulées, un ongle au bout.
  const fingers = FINGERS.map((spec) => {
    const joints = [];
    let parent = new THREE.Group();
    parent.position.set(-side * spec.x, 0.002, spec.base);
    hand.add(parent);
    spec.lengths.forEach((length, i) => {
      const joint = i === 0 ? parent : new THREE.Group();
      if (i > 0) { joint.position.z = -spec.lengths[i - 1]; parent.add(joint); }
      const radius = spec.radius * (1 - i * 0.08);
      joint.add(new THREE.Mesh(segmentGeometry(radius, length), SKIN()));
      if (i === 2) {
        const nail = new THREE.Mesh(nailGeometry(), NAIL());
        nail.scale.set(radius * 0.72, radius * 0.22, radius * 0.95);
        nail.position.set(0, radius * 0.8, -length + radius * 1.15);
        joint.add(nail);
      }
      joints.push(joint);
      parent = joint;
    });
    return joints;
  });
  // Pouce : métacarpe et deux phalanges, sur le côté, tourné vers les doigts.
  const thumbBase = new THREE.Group();
  thumbBase.position.set(-side * 0.036, -0.006, -0.03);
  thumbBase.rotation.set(-0.25, -side * 0.75, side * 0.45);
  hand.add(thumbBase);
  const thumb = [];
  let parent = thumbBase;
  [0.034, 0.03, 0.024].forEach((length, i) => {
    const joint = i === 0 ? thumbBase : new THREE.Group();
    if (i > 0) { joint.position.z = -[0.034, 0.03][i - 1]; parent.add(joint); }
    const radius = 0.0115 - i * 0.0008;
    joint.add(new THREE.Mesh(segmentGeometry(radius, length), SKIN()));
    if (i === 2) {
      const nail = new THREE.Mesh(nailGeometry(), NAIL());
      nail.scale.set(radius * 0.72, radius * 0.22, radius * 0.95);
      nail.position.set(0, radius * 0.8, -length + radius * 1.15);
      joint.add(nail);
    }
    thumb.push(joint);
    parent = joint;
  });
  hand.traverse((child) => { if (child.isMesh) { child.castShadow = false; child.renderOrder = 10; } });
  return { hand, fingers, thumb, side };
}

/** Plie les doigts : `curl` (0 ouvert … 1 fermé) par doigt, `thumb` (0 … 1). */
function bend(data, curls, thumbCurl, k) {
  data.fingers.forEach((joints, f) => {
    const curl = Array.isArray(curls) ? curls[f] : curls;
    joints.forEach((joint, i) => {
      const target = -curl * (i === 0 ? 1.05 : i === 1 ? 1.25 : 0.9);
      joint.rotation.x += (target - joint.rotation.x) * k;
    });
  });
  data.thumb.forEach((joint, i) => {
    if (i === 0) return;
    const target = -thumbCurl * (i === 1 ? 0.7 : 0.8);
    joint.rotation.x += (target - joint.rotation.x) * k;
  });
}

/** Poses fixes (repère de la caméra) : position, rotation, doigts, pouce. */
// Repère d'une main : doigts vers -z, avant-bras vers +z. Une rotation x positive relève les doigts
// et fait descendre l'avant-bras vers le bas de l'écran (le bras vient d'en bas, comme dans la réalité) ;
// y : la main gauche tournée vers le centre (négatif), la droite (positif) ; z : la paume vers l'intérieur.
const POSES = {
  idle: {
    left: { p: [-0.225, -0.27, -0.4], r: [0.5, -0.32, 0.42], curl: 0.42, thumb: 0.28 },
    right: { p: [0.225, -0.27, -0.4], r: [0.5, 0.32, -0.42], curl: 0.42, thumb: 0.28 },
  },
  push: {
    left: { p: [-0.2, -0.215, -0.44], r: [0.42, -0.26, 0.3], curl: 0.26, thumb: 0.2 },
    right: { p: [0.2, -0.215, -0.44], r: [0.42, 0.26, -0.3], curl: 0.26, thumb: 0.2 },
  },
  cable: {
    left: { p: [-0.2, -0.23, -0.42], r: [0.4, -0.3, 1.0], curl: 0.85, thumb: 0.6 },
    right: { p: [0.18, -0.2, -0.44], r: [0.45, 0.25, -0.55], curl: [0.55, 0.85, 0.95, 0.95], thumb: 0.55 },
  },
};

const ease = (t) => 1 - (1 - t) ** 3;

/**
 * @param {THREE.Camera} camera
 * @param {THREE.Scene} scene
 */
export function createHands(camera, scene) {
  const rig = new THREE.Group();
  rig.name = 'mains';
  rig.visible = false;
  camera.add(rig);
  if (!camera.parent) scene.add(camera); // les enfants de la caméra ne sont dessinés que si elle est dans la scène
  const left = buildHand(-1);
  const right = buildHand(1);
  rig.add(left.hand, right.hand);
  const heldSlot = new THREE.Group(); // ce que Steve porte, devant lui
  const HELD_AT = new THREE.Vector3(0, -0.2, -0.56);
  heldSlot.position.copy(HELD_AT);
  rig.add(heldSlot);
  let held = null; // { object, size: Vector3, anim }
  // Câble : rouleau dans la paume gauche, fiche pincée dans la droite.
  // Câble en main : un rouleau de plusieurs spires accroché à la main gauche (tourné vers Steve), la
  // fiche pincée dans la main droite, et entre les deux le câble lui-même, continu : un bout de câble
  // sort du rouleau et va jusqu'à la fiche. Une fois le premier bout branché, le câble part de la
  // prise et revient au rouleau (on le déroule en marchant), et l'autre bout est la fiche en main.
  const coil = new THREE.Group();
  const coilGeometry = once('g:coilTurn', () => new THREE.TorusGeometry(0.058, 0.0075, 8, 32));
  const turns = [0, 1, 2, 3].map((i) => {
    const turn = new THREE.Mesh(coilGeometry, material('m:coilDefault', 0x4a8af4));
    turn.position.set(i * 0.004 - 0.006, -i * 0.006, i * 0.007);
    turn.rotation.z = i * 0.5;
    turn.renderOrder = 10;
    coil.add(turn);
    return turn;
  });
  coil.position.set(0.0, -0.075, -0.05); // pendu sous la paume, retenu par les doigts
  coil.visible = false;
  left.hand.add(coil);
  const plug = new THREE.Group();
  plug.position.set(-0.03, -0.016, -0.115);
  plug.rotation.set(-1.2, 0, 0.3);
  plug.visible = false;
  right.hand.add(plug);
  let cableColor = null;
  let hanging = null; // câble branché par un bout : { mesh, from: Vector3 (monde) } — de la prise au rouleau
  let lead = null; // du rouleau à la fiche en main droite
  const plugTail = new THREE.Vector3();
  const coilOut = new THREE.Vector3();
  const coilIn = new THREE.Vector3();
  const faceCamera = new THREE.Quaternion();
  const handQuat = new THREE.Quaternion();
  /** Tube souple entre deux points (monde), qui pend un peu entre eux. */
  function drape(mesh, from, to, sag) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y -= Math.min(0.5, from.distanceTo(to) * sag);
    const curve = new THREE.CatmullRomCurve3([from.clone(), from.clone().lerp(mid, 0.55), mid, to.clone().lerp(mid, 0.45), to.clone()]);
    const old = mesh.geometry;
    mesh.geometry = new THREE.TubeGeometry(curve, 28, 0.0075, 7, false);
    old.dispose();
  }

  let pose = 'idle';
  let reach = 0; // 0 … 1 : main droite tendue
  let bob = 0;
  let enabled = false;
  const dropping = []; // objets en route vers leur place : { object, from, to, t, duration, resolve }

  /** Pose des deux mains pour tenir l'objet porté par ses côtés (paumes vers lui, doigts dessous). */
  function holdPose() {
    const { size } = held;
    const c = heldSlot.position;
    const grip = (side) => ({
      // Le dos de la main à l'extérieur, la paume contre le flanc, un peu sous le milieu.
      p: [c.x + side * (size.x / 2 + 0.017), c.y - Math.min(size.y * 0.22, 0.05) - 0.012, c.z + size.z * 0.15],
      r: [0.15, side * 0.1, -side * Math.PI / 2],
      curl: 0.95,
      thumb: 0.15,
    });
    return { left: grip(-1), right: grip(1) };
  }

  function applyPose(dt, moving) {
    const p = pose === 'hold' && held ? holdPose() : POSES[pose] || POSES.idle;
    bob += moving ? dt * 0.009 : dt * 0.0015;
    const sway = Math.sin(bob) * (moving ? 0.011 : 0.003);
    const lift = Math.abs(Math.cos(bob)) * (moving ? 0.009 : 0.002);
    const k = Math.min(1, dt / 85); // amorti : les mains rejoignent leur pose en ~0,1 s
    for (const data of [left, right]) {
      const target = p[data.side < 0 ? 'left' : 'right'];
      const extra = data.side > 0 && pose !== 'hold' ? reach : 0;
      const tx = target.p[0] + sway * (pose === 'hold' ? 1 : data.side);
      data.hand.position.x += (tx - data.hand.position.x) * k;
      data.hand.position.y += (target.p[1] + lift + extra * 0.05 - data.hand.position.y) * k;
      data.hand.position.z += (target.p[2] - extra * 0.15 - data.hand.position.z) * k;
      data.hand.rotation.x += (target.r[0] - data.hand.rotation.x) * k;
      data.hand.rotation.y += (target.r[1] - data.hand.rotation.y) * k;
      data.hand.rotation.z += (target.r[2] - data.hand.rotation.z) * k;
      bend(data, target.curl, target.thumb, k);
    }
    // L'objet porté suit les mains (balancement de la marche).
    heldSlot.position.set(HELD_AT.x + sway, (held ? held.y : HELD_AT.y) + lift, HELD_AT.z);
    reach = Math.max(0, reach - dt / 260);
  }

  function animateHeld(dt) {
    const anim = held && held.anim;
    if (!anim) return;
    anim.t = Math.min(1, anim.t + dt / anim.duration);
    const e = ease(anim.t);
    held.object.position.lerpVectors(anim.from.p, anim.to.p, e);
    held.object.quaternion.slerpQuaternions(anim.from.q, anim.to.q, e);
    held.object.scale.lerpVectors(anim.from.s, anim.to.s, e);
    if (anim.t >= 1) held.anim = null;
  }

  function animateDrops(dt) {
    for (let i = dropping.length - 1; i >= 0; i -= 1) {
      const drop = dropping[i];
      drop.t = Math.min(1, drop.t + dt / drop.duration);
      const e = ease(drop.t);
      drop.object.position.lerpVectors(drop.from.p, drop.to.p, e);
      drop.object.quaternion.slerpQuaternions(drop.from.q, drop.to.q, e);
      drop.object.scale.lerpVectors(drop.from.s, drop.to.s, e);
      if (drop.t >= 1) {
        drop.object.removeFromParent();
        dropping.splice(i, 1);
        drop.resolve();
      }
    }
  }

  const decompose = (matrix) => {
    const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
    matrix.decompose(p, q, s);
    return { p, q, s };
  };

  return {
    /** À chaque image (lab.mjs) : `moving` quand Steve marche. */
    update(dt, { moving = false } = {}) {
      animateDrops(dt);
      rig.visible = enabled;
      if (!enabled) {
        if (hanging) hanging.mesh.visible = false;
        if (lead) lead.visible = false;
        return;
      }
      applyPose(dt, moving);
      animateHeld(dt);
      if (cableColor) {
        // Le rouleau reste tourné vers Steve (on voit ses spires, pas leur tranche).
        rig.updateMatrixWorld(true);
        camera.getWorldQuaternion(faceCamera);
        left.hand.getWorldQuaternion(handQuat);
        coil.quaternion.copy(handQuat.invert().multiply(faceCamera)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.25, 0)));
        coil.updateMatrixWorld(true);
        // Le câble sort du bas du rouleau vers la fiche ; celui qui vient de la prise y entre par le haut.
        coil.localToWorld(coilOut.set(0.05, -0.04, 0.012));
        coil.localToWorld(coilIn.set(-0.05, -0.035, 0.012));
        plug.localToWorld(plugTail.set(0, 0, 0.055)); // le manchon de la fiche, côté câble
        if (lead) { lead.visible = true; drape(lead, coilOut, plugTail, 0.35); }
        if (hanging) { hanging.mesh.visible = true; drape(hanging.mesh, hanging.from, coilIn, 0.25); }
      }
    },
    /** Mains visibles (vue à la première personne) ou non (survol, VR). */
    setEnabled(on) { enabled = !!on; },
    get enabled() { return enabled; },
    /** La main droite se tend (prendre, poser, brancher). */
    reach() { reach = 1; },
    /**
     * Objet porté à deux mains (déjà à sa taille dans la salle), ou null. Il est réduit pour tenir
     * entre les mains (au plus 42 cm de large à l'image) et centré devant Steve, un peu bas.
     * `from` (Matrix4, monde) : là où il était (étagère, meuble) — il glisse de là jusqu'aux mains.
     */
    setHeld(object, { from = null } = {}) {
      while (heldSlot.children.length) heldSlot.remove(heldSlot.children[0]);
      held = null;
      if (object) {
        let box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        object.scale.multiplyScalar(Math.min(1, 0.42 / Math.max(size.x, size.z, 0.01)));
        object.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(object);
        object.position.sub(box.getCenter(new THREE.Vector3()));
        heldSlot.add(object);
        const fitted = box.getSize(new THREE.Vector3());
        // Un objet haut (la tour d'un PC) est tenu un peu plus haut : les mains restent à l'écran.
        held = { object, size: fitted, y: HELD_AT.y + fitted.y * 0.12, anim: null };
        heldSlot.position.y = held.y;
        if (from) {
          heldSlot.updateMatrixWorld(true);
          const to = { p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() };
          const local = new THREE.Matrix4().copy(heldSlot.matrixWorld).invert().multiply(from);
          held.anim = { t: 0, duration: 380, from: decompose(local), to };
          held.object.position.copy(held.anim.from.p);
          held.object.quaternion.copy(held.anim.from.q);
          held.object.scale.copy(held.anim.from.s);
        }
        pose = 'hold';
      } else if (pose === 'hold') pose = 'idle';
      coil.visible = false;
      plug.visible = false;
    },
    /**
     * Pose l'objet porté : il quitte les mains et glisse jusqu'à `to` (Matrix4, monde : sa place),
     * en `duration` ms. Retourne une promesse résolue à l'arrivée (l'objet est alors retiré).
     */
    dropTo(to, duration = 300) {
      if (!held) return Promise.resolve();
      const { object } = held;
      held = null;
      pose = 'idle';
      reach = 1;
      object.updateMatrixWorld(true);
      scene.attach(object); // garde sa place à l'écran en quittant les mains
      return new Promise((resolve) => {
        dropping.push({ object, from: decompose(object.matrix), to: decompose(to), t: 0, duration, resolve });
      });
    },
    /** Taille (monde) et centre de l'objet porté, ou null. */
    get heldObject() { return held ? held.object : null; },
    /** Steve pousse un meuble (aperçu au sol devant lui). */
    setPushing(on) {
      if (on) pose = 'push';
      else if (pose === 'push') pose = 'idle';
    },
    /**
     * Câble en main : `color` de la gaine (null : rien en main), `plugModel` (fiche 3D de ce type
     * de câble, déjà mise à l'échelle), `from` : point (monde) de la prise où le premier bout est
     * branché (null : aucun bout branché).
     */
    setCable(color, plugModel = null, from = null) {
      while (plug.children.length) plug.remove(plug.children[0]);
      if (hanging) { hanging.mesh.removeFromParent(); hanging.mesh.geometry.dispose(); hanging = null; }
      if (lead) { lead.removeFromParent(); lead.geometry.dispose(); lead = null; }
      cableColor = color || null;
      if (!color) {
        coil.visible = false;
        plug.visible = false;
        if (pose === 'cable') pose = 'idle';
        return;
      }
      pose = 'cable';
      const jacket = material(`m:coil:${color}`, color, { roughness: 0.5 });
      for (const turn of turns) turn.material = jacket;
      coil.visible = true;
      plug.visible = true;
      if (plugModel) plug.add(plugModel);
      const cord = () => {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), jacket);
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        scene.add(mesh);
        return mesh;
      };
      lead = cord();
      if (from) hanging = { mesh: cord(), from: from.clone() };
    },
    /** Rien en main. */
    clear() {
      this.setHeld(null);
      this.setCable(null);
      this.setPushing(false);
      pose = 'idle';
    },
  };
}
