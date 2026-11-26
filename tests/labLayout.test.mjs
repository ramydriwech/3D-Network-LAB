// Plan de la salle du laboratoire : meubles, emplacements, plan automatique (src/render/labLayout.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  FURNITURE, EMPTY_ROOM, mountKindOf, mountKindsOf, ensureLayout, unitsOf, footprint, canPlaceFurniture, canMount, firstFreeSlot, slotAt, mountPose,
  autoLayout, layoutOf, addFurniture, moveFurniture, removeFurniture, mountDevice, toRoomPoint, toLocalPoint, LayoutError,
} from '../src/render/labLayout.mjs';
import { readScenario } from './helpers.mjs';
import * as B from '../src/sim/builder.mjs';

const pc = { id: 'pc1', type: 'host', model: 'pc-std', position: [0, 0, 0] };
const sw24 = { id: 'sw1', type: 'switch', model: 'sw-24g', position: [0, 0, 0] };
const sw8 = { id: 'sw2', type: 'switch', model: 'sw-8g', position: [0, 0, 0] };
const srv = { id: 'srv1', type: 'server', model: 'srv-1g', position: [0, 0, 0] };

test('salle : chaque modèle a sa place (bureau, baie, table) et sa hauteur en U', () => {
  assert.equal(mountKindOf(pc), 'desk');
  assert.equal(mountKindOf(sw24), 'rack');
  assert.equal(mountKindOf(sw8), 'rack'); // un petit switch va en baie (sur une tablette)…
  assert.deepEqual(mountKindsOf(sw8), ['rack', 'table']); // … ou sur une table
  assert.equal(mountKindOf(srv), 'rack');
  assert.equal(unitsOf(sw24), 1);
  assert.equal(unitsOf(srv), 2);
});

test('salle : rotation par quarts de tour, empreinte au sol', () => {
  const rack = { id: 'm1', kind: 'rack12', x: 1, z: 2, rot: 90 };
  const box = footprint(rack);
  assert.deepEqual([box.maxX - box.minX, box.maxZ - box.minZ].map((v) => +v.toFixed(2)), [0.8, 1.24]);
  const p = toRoomPoint(rack, [0.3, 1, 0.2]);
  assert.deepEqual(toLocalPoint(rack, p).map((v) => +v.toFixed(6)), [0.3, 1, 0.2]);
});

test('salle : un meuble ne se pose ni contre un mur, ni devant la porte, ni sur un autre', () => {
  const layout = { room: { ...EMPTY_ROOM }, furniture: [{ id: 'm1', kind: 'rack12', x: 0, z: 0, rot: 0 }], mounts: {} };
  assert.equal(canPlaceFurniture(layout, { id: 'n', kind: 'desk', x: -3, z: -1, rot: 0 }).ok, true);
  assert.equal(canPlaceFurniture(layout, { id: 'n', kind: 'desk', x: 0.5, z: 0, rot: 0 }).reason, 'furniture');
  assert.equal(canPlaceFurniture(layout, { id: 'n', kind: 'desk', x: -5.9, z: 0, rot: 0 }).reason, 'wall');
  assert.equal(canPlaceFurniture(layout, { id: 'n', kind: 'table', x: 0, z: 3.9, rot: 0 }).reason, 'reserved'); // devant la porte
  assert.equal(canPlaceFurniture(layout, { id: 'n', kind: 'table', x: 4.8, z: 0, rot: 0 }).reason, 'reserved'); // étagères
  assert.equal(canPlaceFurniture(layout, { id: 'm1', kind: 'rack12', x: 0.2, z: 0, rot: 0 }, 'm1').ok, true); // on se déplace soi-même
});

test('salle : emplacements U d\'une baie, places d\'une table', () => {
  const layout = { room: { ...EMPTY_ROOM }, furniture: [{ id: 'r', kind: 'rack6', x: 0, z: 0, rot: 0 }, { id: 't', kind: 'table', x: 3, z: 0, rot: 0 }], mounts: { srv1: { on: 'r', slot: 1 } } };
  const devices = [srv, sw24, sw8, pc];
  assert.equal(canMount(layout, devices, sw24, 'r', 2).reason, 'taken'); // U1-U2 pris par le serveur 2U
  assert.equal(canMount(layout, devices, sw24, 'r', 3).ok, true);
  assert.equal(canMount(layout, devices, sw24, 'r', 7).reason, 'range'); // baie de 6U
  assert.equal(canMount(layout, devices, srv, 'r', 6).reason, 'range'); // un 2U ne tient pas en U6
  assert.equal(canMount(layout, devices, pc, 'r', 3).reason, 'kind'); // un PC va sur un bureau
  assert.equal(firstFreeSlot(layout, devices, sw24, 'r'), 3);
  assert.equal(canMount(layout, devices, sw8, 't', 1).ok, true);
  // Viser la baie à 52 cm de haut (U4 de la baie basse, qui commence à 15 cm) ; viser la moitié droite de la table.
  assert.equal(slotAt(layout, devices, sw24, 'r', [0, 0.52, 0.3]), 4);
  assert.equal(slotAt(layout, devices, sw8, 't', [3.3, 0.8, 0]), 1);
});

test('salle : position d\'un équipement installé (baie tournée d\'un quart de tour)', () => {
  const layout = { room: { ...EMPTY_ROOM }, furniture: [{ id: 'r', kind: 'rack12', x: 2, z: -1, rot: 90 }], mounts: { sw1: { on: 'r', slot: 4 } } };
  const pose = mountPose(layout, sw24);
  assert.equal(pose.rot, 90);
  assert.equal(+pose.point[1].toFixed(3), +(0.45 + 0.3).toFixed(3)); // U4 = 3 U au-dessus du premier
  assert.ok(pose.point[0] > 2); // façade tournée vers +x : l'équipement est décalé vers +x
  assert.equal(mountPose(layout, pc), null); // pas installé
});

test('salle : plan automatique des scénarios fournis — chaque équipement installé, aucun meuble qui en chevauche un autre', () => {
  const files = readdirSync(new URL('../scenarios/', import.meta.url)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const file of files) {
    const scenario = readScenario(file.replace('.json', ''));
    const layout = autoLayout(scenario);
    for (const def of scenario.devices) {
      assert.ok(layout.mounts[def.id], `${file} : ${def.id} n'est installé nulle part`);
      assert.ok(mountPose(layout, def), `${file} : ${def.id} sans position`);
    }
    for (const item of layout.furniture) {
      for (const other of layout.furniture) {
        if (other === item) continue;
        const a = footprint(item); const b = footprint(other);
        assert.ok(!(a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ), `${file} : ${item.id} chevauche ${other.id}`);
      }
    }
  }
});

test('salle : construire de zéro avec le brouillon de l\'éditeur', () => {
  let draft = B.emptyDraft();
  assert.deepEqual(layoutOf(draft).furniture, []);
  let result = addFurniture(draft, 'rack12', -2, -1, 0);
  draft = result.draft;
  const rackId = result.id;
  result = addFurniture(draft, 'desk', 1, -1, 180);
  draft = result.draft;
  const deskId = result.id;
  assert.throws(() => addFurniture(draft, 'desk', 1.2, -1), LayoutError); // place prise
  const added = B.addDevice(draft, 'switch', { model: 'sw-24g' });
  draft = mountDevice(added.draft, added.id, rackId, 5);
  const host = B.addDevice(draft, 'host', {});
  assert.throws(() => mountDevice(host.draft, host.id, rackId, 1), LayoutError); // un PC ne va pas en baie
  draft = mountDevice(host.draft, host.id, deskId, 0);
  assert.deepEqual(draft.lab.mounts[added.id], { on: rackId, slot: 5 });
  assert.throws(() => removeFurniture(draft, rackId), LayoutError); // la baie porte un switch
  draft = moveFurniture(draft, rackId, -3, 0, 90);
  assert.equal(draft.lab.furniture.find((f) => f.id === rackId).rot, 90);
  // Un équipement retiré disparaît du plan ; le meuble vide peut alors partir.
  draft = B.removeDevice(draft, added.id);
  assert.equal(layoutOf(draft).mounts[added.id], undefined);
  draft = removeFurniture(draft, rackId);
  assert.equal(draft.lab.furniture.length, 1);
});

test('salle : dans les scénarios, switchs, routeurs et pare-feu sont en baie (jamais sur une table)', () => {
  const files = readdirSync(new URL('../scenarios/', import.meta.url)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const file of files) {
    const scenario = readScenario(file.replace('.json', ''));
    const layout = autoLayout(scenario);
    for (const def of scenario.devices.filter((d) => d.type !== 'host')) {
      const item = layout.furniture.find((f) => f.id === layout.mounts[def.id].on);
      assert.equal(FURNITURE[item.kind].kind, 'rack', `${file} : ${def.id} (${def.model}) est sur ${item.kind}`);
    }
  }
});

test('salle : installer un équipement neuf dans une baie d\'un scénario ne crée pas de meuble vide', () => {
  const scenario = readScenario('ping');
  const before = autoLayout(scenario);
  const rack = before.furniture.find((f) => f.kind === 'rack12');
  // Comme le geste du labo : le plan d'abord écrit, puis l'équipement ajouté et installé.
  const planned = ensureLayout(B.draftFrom(scenario));
  const added = B.addDevice(planned, 'router', { model: 'rt-2g' });
  const draft = mountDevice(added.draft, added.id, rack.id, 8);
  assert.equal(draft.lab.furniture.length, before.furniture.length); // aucun meuble en plus
  assert.deepEqual(draft.lab.mounts[added.id], { on: rack.id, slot: 8 });
  // Même sans écrire le plan d'abord, mountDevice ne laisse pas de meuble vide derrière lui.
  const direct = B.addDevice(ensureLayout(B.draftFrom(scenario)), 'switch', { model: 'sw-24g' });
  const placed = mountDevice(direct.draft, direct.id, rack.id, 10);
  assert.equal(placed.lab.furniture.length, before.furniture.length);
});

test('salle : un petit switch se pose aussi sur une tablette de baie', () => {
  const layout = { room: { ...EMPTY_ROOM }, furniture: [{ id: 'r', kind: 'rack12', x: 0, z: 0, rot: 0 }], mounts: { sw2: { on: 'r', slot: 3 } } };
  assert.equal(canMount(layout, [sw8], sw8, 'r', 3).ok, true);
  const pose = mountPose(layout, sw8);
  assert.ok(pose.point[1] > 0.45 + 0.2); // U3, sur la tablette
});

test('salle : un équipement ajouté hors du labo (mode classique) reçoit une place', () => {
  let draft = addFurniture(B.emptyDraft(), 'table', -2, -1).draft;
  const sw = B.addDevice(draft, 'switch', { model: 'sw-8g' });
  draft = sw.draft;
  const layout = layoutOf(draft);
  assert.equal(layout.mounts[sw.id].on, draft.lab.furniture[0].id); // la table existante, place libre
  const pcAdded = B.addDevice(draft, 'host', {});
  const layout2 = layoutOf(pcAdded.draft);
  assert.equal(FURNITURE[layout2.furniture.find((f) => f.id === layout2.mounts[pcAdded.id].on).kind].kind, 'desk'); // un bureau rien que pour lui
});
